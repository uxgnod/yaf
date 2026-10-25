// 洞察生成：取材料 → 聚类 → 分簇总结（Map）→ 汇总报告（Reduce）→ 校验引用。
// 每一步都是纯函数 + 可序列化的输入输出，便于放进 Workflow 的 step 里重试。
import { generateText, Output, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { Env } from "./env";
import { escapeLike } from "./memo-service";
import { open } from "./lib/secret-box";
import { RELATED_MIN } from "./search";

// 实测（2026-10-25）：qwen3-30b-a3b 中文和结构化输出稳定、5–10 秒；qwen3.8-27b 质量更好但长输入会超时；
// deepseek-v4 / glm-5.3 不在免费套餐；gpt-oss 结构化输出解析失败
export const WORKERS_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
export const CLAUDE_MODEL = "claude-sonnet-5-5";
const MAX_WINDOW = 150;
const MAX_HISTORY = 30;
const MEMO_CHARS = 400;
const SINGLE_CLUSTER_MAX = 24;

export interface PlanConfig {
  id: string | null;
  name: string;
  scopeTags: string[];
  windowDays: number;
  perspective: string;
  extraPrompt: string;
  model: "workers-ai" | "claude";
}

/** 交给模型的 memo：ref 是短编号（W1 窗口内 / H1 历史），比 UUID 更不容易抄错 */
export interface MaterialMemo {
  ref: string;
  id: string;
  createdAt: number;
  tags: string[];
  text: string;
}

export interface Material {
  window: MaterialMemo[];
  history: MaterialMemo[];
  /** 每个元素是一组 ref */
  clusters: string[][];
  feedbackHint: string;
}

// ---------- 报告结构 ----------

const refs = z.array(z.string()).describe("引用的 memo 编号，如 W3、H2；至少 1 个");
const item = z.object({ title: z.string(), detail: z.string(), refs });

export const ReportSchema = z.object({
  title: z.string().describe("一句话标题，不超过 20 字"),
  summary: z.string().describe("2–4 句话的总体摘要"),
  themes: z.array(item).describe("反复出现的主题（2–4 条）"),
  connections: z.array(item).describe("新的连接：近期 memo 与历史 memo、或不同主题之间的关联（0–3 条）"),
  unfinished: z.array(item).describe("想做但还没做的事、悬而未决的计划（0–3 条）"),
  questions: z
    .array(z.object({ question: z.string(), why: z.string(), refs }))
    .describe("值得继续追问自己的问题（1–3 条）"),
});
export type Report = z.infer<typeof ReportSchema>;

const ClusterSchema = z.object({
  theme: z.string().describe("这组 memo 的主题，不超过 12 字"),
  points: z.array(z.object({ text: z.string(), refs })).describe("2–4 条要点"),
});
export type ClusterSummary = z.infer<typeof ClusterSchema>;

/** 校验后的报告：ref 换成真实 memo id；没有有效引用的条目被丢弃 */
export interface CheckedItem {
  title: string;
  detail: string;
  memoIds: string[];
}
export interface InsightContent {
  summary: string;
  themes: CheckedItem[];
  connections: CheckedItem[];
  unfinished: CheckedItem[];
  questions: { question: string; why: string; memoIds: string[] }[];
  memos: Record<string, { createdAt: number; excerpt: string }>;
  stats: { window: number; history: number; clusters: number; dropped: number };
}

// ---------- 取材料 ----------

function clip(s: string, n = MEMO_CHARS) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export async function gatherMaterial(env: Env, userId: string, plan: PlanConfig, periodStart: number, periodEnd: number) {
  const where = ["m.user_id = ?", "m.created_at >= ?", "m.created_at < ?"];
  const params: unknown[] = [userId, periodStart, periodEnd];
  if (plan.scopeTags.length) {
    where.push(
      `EXISTS (SELECT 1 FROM memo_tags t WHERE t.memo_id = m.id AND (${plan.scopeTags
        .map(() => "t.tag = ? OR t.tag LIKE ? ESCAPE '\\'")
        .join(" OR ")}))`,
    );
    for (const t of plan.scopeTags) params.push(t, `${escapeLike(t)}/%`);
  }
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.content, m.created_at,
            (SELECT group_concat(tag, char(31)) FROM memo_tags WHERE memo_id = m.id) AS tags
       FROM memos m WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC LIMIT ?`,
  )
    .bind(...params, MAX_WINDOW)
    .all<{ id: string; content: string; created_at: number; tags: string | null }>();
  const windowRows = results.reverse();
  const window: MaterialMemo[] = windowRows.map((r, i) => ({
    ref: `W${i + 1}`,
    id: r.id,
    createdAt: r.created_at,
    tags: r.tags ? r.tags.split("\u001f") : [],
    text: clip(r.content),
  }));

  // 用窗口内 memo 的向量召回历史上相关的 memo
  const windowIds = new Set(window.map((m) => m.id));
  const scores = new Map<string, number>();
  for (const m of window.slice(-20)) {
    try {
      const { matches } = await env.VECTORS.queryById(m.id, { topK: 6, filter: { userId } });
      for (const hit of matches) {
        if (windowIds.has(hit.id) || hit.score < RELATED_MIN) continue;
        scores.set(hit.id, Math.max(scores.get(hit.id) ?? 0, hit.score));
      }
    } catch {
      /* 这条还没有向量 */
    }
  }
  const historyIds = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_HISTORY).map(([id]) => id);
  let history: MaterialMemo[] = [];
  if (historyIds.length) {
    const { results: rows } = await env.DB.prepare(
      `SELECT m.id, m.content, m.created_at,
              (SELECT group_concat(tag, char(31)) FROM memo_tags WHERE memo_id = m.id) AS tags
         FROM memos m WHERE m.user_id = ? AND m.created_at < ? AND m.id IN (${historyIds.map(() => "?").join(",")})
        ORDER BY m.created_at`,
    )
      .bind(userId, periodStart, ...historyIds)
      .all<{ id: string; content: string; created_at: number; tags: string | null }>();
    history = rows.map((r, i) => ({
      ref: `H${i + 1}`,
      id: r.id,
      createdAt: r.created_at,
      tags: r.tags ? r.tags.split("\u001f") : [],
      text: clip(r.content),
    }));
  }

  const clusters = await clusterWindow(env, window);
  const feedbackHint = await loadFeedbackHint(env, userId, plan.id);
  return { window, history, clusters, feedbackHint } satisfies Material;
}

async function loadFeedbackHint(env: Env, userId: string, planId: string | null) {
  const { results } = await env.DB.prepare(
    `SELECT title, feedback FROM insights
      WHERE user_id = ? AND feedback IS NOT NULL AND (? IS NULL OR plan_id = ?)
      ORDER BY created_at DESC LIMIT 6`,
  )
    .bind(userId, planId, planId)
    .all<{ title: string | null; feedback: string }>();
  if (!results.length) return "";
  const liked = results.filter((r) => r.feedback === "useful").map((r) => `「${r.title}」`);
  const disliked = results.filter((r) => r.feedback === "useless").map((r) => `「${r.title}」`);
  return [
    liked.length ? `用户觉得有用的历史报告：${liked.join("、")}。` : "",
    disliked.length ? `用户觉得没用的历史报告：${disliked.join("、")}，避免类似的泛泛而谈。` : "",
  ].join("");
}

// ---------- 聚类（余弦 k-means） ----------

function normalize(v: number[]) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export function kmeans(vectors: number[][], k: number, iterations = 12): number[] {
  const vs = vectors.map(normalize);
  // 最远点初始化：第一个中心取第 0 个，之后每次取离现有中心最远的点
  const centers = [vs[0]];
  while (centers.length < k) {
    let best = 0;
    let bestDist = -1;
    vs.forEach((v, i) => {
      const d = 1 - Math.max(...centers.map((c) => dot(v, c)));
      if (d > bestDist) (bestDist = d), (best = i);
    });
    centers.push(vs[best]);
  }
  let assign = new Array(vs.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const next = vs.map((v) => {
      let bi = 0;
      let bs = -Infinity;
      centers.forEach((c, i) => {
        const s = dot(v, c);
        if (s > bs) (bs = s), (bi = i);
      });
      return bi;
    });
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    for (let c = 0; c < k; c++) {
      const members = vs.filter((_, i) => assign[i] === c);
      if (!members.length) continue;
      centers[c] = normalize(members[0].map((_, d) => members.reduce((s, m) => s + m[d], 0)));
    }
    if (!changed && it > 0) break;
  }
  return assign;
}

async function clusterWindow(env: Env, window: MaterialMemo[]): Promise<string[][]> {
  if (window.length <= SINGLE_CLUSTER_MAX) return [window.map((m) => m.ref)];
  const values = new Map<string, number[]>();
  for (let i = 0; i < window.length; i += 20) {
    const chunk = window.slice(i, i + 20).map((m) => m.id);
    for (const v of await env.VECTORS.getByIds(chunk)) if (v.values) values.set(v.id, Array.from(v.values));
  }
  const withVec = window.filter((m) => values.has(m.id));
  const without = window.filter((m) => !values.has(m.id));
  const k = Math.max(2, Math.min(6, Math.round(Math.sqrt(withVec.length / 2))));
  const clusters: string[][] = Array.from({ length: k }, () => []);
  if (withVec.length >= k) {
    const assign = kmeans(withVec.map((m) => values.get(m.id)!), k);
    withVec.forEach((m, i) => clusters[assign[i]].push(m.ref));
  } else clusters[0].push(...withVec.map((m) => m.ref));
  if (without.length) clusters.push(without.map((m) => m.ref));
  return clusters.filter((c) => c.length);
}

// ---------- 模型 ----------

export async function getModel(env: Env, userId: string, choice: PlanConfig["model"]): Promise<{ model: LanguageModel; name: string }> {
  const gatewayId = env.AI_GATEWAY_ID || undefined;
  if (choice === "claude") {
    const row = await env.DB.prepare("SELECT anthropic_key_enc FROM user_settings WHERE user_id = ?")
      .bind(userId)
      .first<{ anthropic_key_enc: string | null }>();
    if (!row?.anthropic_key_enc) throw new Error("还没有设置 Claude API key（设置 › 洞察与搜索）");
    const apiKey = await open(env.ENCRYPTION_KEY, row.anthropic_key_enc);
    const baseURL = gatewayId ? `${await env.AI.gateway(gatewayId).getUrl("anthropic")}/v1` : undefined;
    return { model: createAnthropic({ apiKey, baseURL })(CLAUDE_MODEL), name: CLAUDE_MODEL };
  }
  const workersai = createWorkersAI({ binding: env.AI, ...(gatewayId ? { gateway: { id: gatewayId } } : {}) });
  return { model: workersai(WORKERS_AI_MODEL), name: WORKERS_AI_MODEL };
}

const PERSPECTIVE: Record<string, string> = {
  balanced: "各方面平衡地看。",
  patterns: "重点找反复出现的模式、习惯和情绪变化。",
  actions: "重点找想做但没做的事、可以落地的下一步。",
  questions: "重点提出能引发深入思考的问题，而不是给结论。",
};

function formatMemos(list: MaterialMemo[]) {
  return list
    .map((m) => {
      const d = new Date(m.createdAt).toISOString().slice(0, 10);
      return `[${m.ref}] ${d}${m.tags.length ? " " + m.tags.map((t) => "#" + t).join(" ") : ""}\n${m.text}`;
    })
    .join("\n\n");
}

const SYSTEM = `你是用户的个人笔记分析助手。用户用 flomo 式的短笔记（memo）记录想法、生活和工作。
你的任务是从这些 memo 里找出真正有价值的观察，帮助用户更了解自己。
规则：
- 每条结论都必须引用支撑它的 memo 编号（如 W3、H2），只能使用材料里出现过的编号，不能编造。
- 具体、克制，引用原文里的细节；不要空洞的鸡汤和泛泛的建议。
- 用中文，用第二人称「你」称呼用户。`;

export async function summarizeCluster(env: Env, userId: string, plan: PlanConfig, material: Material, refsInCluster: string[]) {
  const set = new Set(refsInCluster);
  const memos = material.window.filter((m) => set.has(m.ref));
  const { model } = await getModel(env, userId, plan.model);
  const { output } = await generateText({
    model,
    system: SYSTEM,
    prompt: `下面是一组内容相近的 memo。概括这组 memo 的主题和 2–4 条要点，每条要点引用对应的编号。\n\n${formatMemos(memos)}`,
    output: Output.object({ schema: ClusterSchema }),
    maxRetries: 2,
  });
  return output;
}

export async function writeReport(
  env: Env,
  userId: string,
  plan: PlanConfig,
  material: Material,
  clusterSummaries: ClusterSummary[],
  period: { start: number; end: number },
) {
  const { model, name } = await getModel(env, userId, plan.model);
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const parts = [
    `分析时段：${fmt(period.start)} 至 ${fmt(period.end)}。${plan.scopeTags.length ? `范围：${plan.scopeTags.map((t) => "#" + t).join(" ")}。` : ""}`,
    `分析视角：${PERSPECTIVE[plan.perspective] ?? PERSPECTIVE.balanced}`,
    plan.extraPrompt ? `用户的补充要求：${plan.extraPrompt}` : "",
    material.feedbackHint,
    clusterSummaries.length > 1
      ? `## 各组 memo 的初步总结\n${clusterSummaries
          .map((c) => `### ${c.theme}\n${c.points.map((p) => `- ${p.text}（${p.refs.join("、")}）`).join("\n")}`)
          .join("\n\n")}`
      : "",
    `## 这段时间的 memo（W 开头）\n${formatMemos(material.window)}`,
    material.history.length
      ? `## 历史上相关的 memo（H 开头，用来发现「新的连接」：现在的想法和过去哪些记录呼应或矛盾）\n${formatMemos(material.history)}`
      : "",
    "请生成一份洞察报告。",
  ];
  const { output } = await generateText({
    model,
    system: SYSTEM,
    prompt: parts.filter(Boolean).join("\n\n"),
    output: Output.object({ schema: ReportSchema }),
    maxRetries: 2,
  });
  return { report: output, model: name };
}

const REF = String.raw`\[?[WH]\d+\]?`;
const REF_GROUP = new RegExp(String.raw`\s*[（(]\s*${REF}(?:\s*[/、,，;；\-–~至和与及]\s*${REF})*\s*[）)]`, "g");
const REF_BARE = new RegExp(String.raw`\s*${REF}(?![\w])`, "g");

/** 去掉正文里的引用编号（W3、（W1/H2）等）；引用以链接形式单独展示 */
export function stripRefs(text: string) {
  return text
    .replace(REF_GROUP, "")
    .replace(REF_BARE, "")
    .replace(/\s*[（(][\s\-–~、,，/]*[）)]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 把 ref 换成真实 memo id；丢弃引用无效的条目，防止模型编造 */
export function checkReport(report: Report, material: Material, clusters: number): InsightContent {
  const byRef = new Map([...material.window, ...material.history].map((m) => [m.ref.toUpperCase(), m]));
  let dropped = 0;
  const used = new Map<string, MaterialMemo>();
  const resolve = (rs: string[]) => {
    const ids: string[] = [];
    for (const r of rs) {
      const m = byRef.get(r.trim().replace(/^\[|\]$/g, "").toUpperCase());
      if (m && !ids.includes(m.id)) ids.push(m.id), used.set(m.id, m);
    }
    return ids;
  };
  const items = (list: { title: string; detail: string; refs: string[] }[]) =>
    list.flatMap((it) => {
      const memoIds = resolve(it.refs);
      if (!memoIds.length) return dropped++, [];
      return [{ title: stripRefs(it.title), detail: stripRefs(it.detail), memoIds }];
    });
  const content: InsightContent = {
    summary: stripRefs(report.summary),
    themes: items(report.themes),
    connections: items(report.connections),
    unfinished: items(report.unfinished),
    questions: report.questions.flatMap((q) => {
      const memoIds = resolve(q.refs);
      if (!memoIds.length) return dropped++, [];
      return [{ question: stripRefs(q.question), why: stripRefs(q.why), memoIds }];
    }),
    memos: {},
    stats: { window: material.window.length, history: material.history.length, clusters, dropped },
  };
  for (const [id, m] of used) content.memos[id] = { createdAt: m.createdAt, excerpt: clip(m.text, 120) };
  return content;
}

/** 把报告转成 Markdown，用于「存为 memo」 */
export function reportToMarkdown(title: string, c: InsightContent) {
  const lines = [`## ${title}`, "", c.summary, ""];
  const section = (name: string, list: CheckedItem[]) => {
    if (!list.length) return;
    lines.push(`### ${name}`, "");
    for (const it of list) lines.push(`- **${it.title}**：${it.detail}`);
    lines.push("");
  };
  section("反复出现的主题", c.themes);
  section("新的连接", c.connections);
  section("想做未做", c.unfinished);
  if (c.questions.length) {
    lines.push("### 值得追问的问题", "");
    for (const q of c.questions) lines.push(`- ${q.question}`);
    lines.push("");
  }
  lines.push("#洞察");
  return lines.join("\n");
}
