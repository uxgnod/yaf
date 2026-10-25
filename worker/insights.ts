import { Hono } from "hono";
import { Cron } from "croner";
import type { AppEnv, Env } from "./env";
import { requireScope, requireUser } from "./auth";
import { seal } from "./lib/secret-box";
import { createMemo } from "./memo-service";
import { scheduleIndex } from "./search";
import { CLAUDE_MODEL, reportToMarkdown, WORKERS_AI_MODEL, type InsightContent, type PlanConfig } from "./insight-engine";

const CADENCES = ["daily", "weekly", "monthly", "custom"] as const;
const PERSPECTIVES = ["balanced", "patterns", "actions", "questions"] as const;
const DEFAULT_WINDOW: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, custom: 7 };

interface PlanRow {
  id: string;
  user_id: string;
  name: string;
  cadence: string;
  cron: string;
  timezone: string;
  scope_tags: string;
  window_days: number;
  perspective: string;
  extra_prompt: string;
  model: string;
  delivery: string;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

function toPlan(r: PlanRow) {
  const [minute, hour, dom, , dow] = r.cron.split(/\s+/);
  const pad = (s: string) => s.padStart(2, "0");
  return {
    id: r.id,
    name: r.name,
    cadence: r.cadence,
    cron: r.cron,
    time: r.cadence === "custom" ? null : `${pad(hour)}:${pad(minute)}`,
    weekday: r.cadence === "weekly" ? Number(dow) : null,
    monthday: r.cadence === "monthly" ? Number(dom) : null,
    timezone: r.timezone,
    scopeTags: JSON.parse(r.scope_tags) as string[],
    windowDays: r.window_days,
    perspective: r.perspective,
    extraPrompt: r.extra_prompt,
    model: r.model,
    delivery: r.delivery,
    enabled: !!r.enabled,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
  };
}

function planConfig(r: PlanRow): PlanConfig {
  return {
    id: r.id,
    name: r.name,
    scopeTags: JSON.parse(r.scope_tags),
    windowDays: r.window_days,
    perspective: r.perspective,
    extraPrompt: r.extra_prompt,
    model: r.model === "claude" ? "claude" : "workers-ai",
  };
}

export function nextRun(cron: string, timezone: string, from = new Date()): number | null {
  return new Cron(cron, { timezone }).nextRun(from)?.getTime() ?? null;
}

class PlanError extends Error {}

/** 把界面上的输入转成库里的字段；非法时抛 PlanError */
function parsePlanInput(body: Record<string, unknown>, prev?: PlanRow) {
  const get = <T>(k: string, fallback: T): T => (body[k] === undefined ? fallback : (body[k] as T));
  const cadence = get("cadence", prev?.cadence ?? "daily");
  if (!CADENCES.includes(cadence as (typeof CADENCES)[number])) throw new PlanError("频率不正确");
  const name = String(get("name", prev?.name ?? "")).trim().slice(0, 40);
  if (!name) throw new PlanError("请填写计划名称");
  const timezone = String(get("timezone", prev?.timezone ?? "Asia/Shanghai"));
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new PlanError("时区不正确");
  }

  let cron: string;
  if (cadence === "custom") {
    cron = String(get("cron", prev?.cron ?? "")).trim();
  } else {
    const prevPlan = prev ? toPlan(prev) : null;
    const time = String(get("time", prevPlan?.time ?? "21:00"));
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new PlanError("时间格式应为 HH:MM");
    const [h, min] = [Number(m[1]), Number(m[2])];
    if (cadence === "daily") cron = `${min} ${h} * * *`;
    else if (cadence === "weekly") {
      const wd = Number(get("weekday", prevPlan?.weekday ?? 0));
      if (!(wd >= 0 && wd <= 6)) throw new PlanError("星期不正确");
      cron = `${min} ${h} * * ${wd}`;
    } else {
      const md = Number(get("monthday", prevPlan?.monthday ?? 1));
      if (!(md >= 1 && md <= 28)) throw new PlanError("日期请选 1–28 号");
      cron = `${min} ${h} ${md} * *`;
    }
  }
  let next: number | null;
  try {
    next = nextRun(cron, timezone);
  } catch {
    throw new PlanError("cron 表达式不正确");
  }

  const scopeTags = get<unknown>("scopeTags", prev ? JSON.parse(prev.scope_tags) : []);
  if (!Array.isArray(scopeTags) || scopeTags.some((t) => typeof t !== "string")) throw new PlanError("范围标签不正确");
  const windowDays = Number(get("windowDays", prev?.window_days ?? DEFAULT_WINDOW[cadence]));
  if (!(windowDays >= 1 && windowDays <= 365)) throw new PlanError("分析窗口请填 1–365 天");
  const perspective = String(get("perspective", prev?.perspective ?? "balanced"));
  if (!PERSPECTIVES.includes(perspective as (typeof PERSPECTIVES)[number])) throw new PlanError("分析视角不正确");
  const model = String(get("model", prev?.model ?? "workers-ai"));
  if (model !== "workers-ai" && model !== "claude") throw new PlanError("模型不正确");
  const enabled = Boolean(get("enabled", prev ? !!prev.enabled : true));

  return {
    name,
    cadence,
    cron,
    timezone,
    scope_tags: JSON.stringify([...new Set(scopeTags.map((t: string) => t.trim().replace(/^#/, "")).filter(Boolean))]),
    window_days: Math.round(windowDays),
    perspective,
    extra_prompt: String(get("extraPrompt", prev?.extra_prompt ?? "")).slice(0, 1000),
    model,
    enabled: enabled ? 1 : 0,
    next_run_at: enabled ? next : null,
  };
}

/** 新建一条「生成中」的洞察并启动 Workflow */
export async function startInsight(env: Env, userId: string, plan: PlanConfig, now = Date.now()) {
  const id = crypto.randomUUID();
  const periodStart = now - plan.windowDays * 86400_000;
  await env.DB.prepare(
    `INSERT INTO insights (id, user_id, plan_id, plan_name, status, period_start, period_end, model, created_at)
     VALUES (?, ?, ?, ?, 'generating', ?, ?, ?, ?)`,
  )
    .bind(id, userId, plan.id, plan.name, periodStart, now, plan.model === "claude" ? CLAUDE_MODEL : WORKERS_AI_MODEL, now)
    .run();
  try {
    await env.INSIGHT_WORKFLOW.create({ id, params: { insightId: id, userId, plan, periodStart, periodEnd: now } });
  } catch (e) {
    await env.DB.prepare("UPDATE insights SET status = 'failed', error = ? WHERE id = ?")
      .bind(`无法启动生成任务：${e instanceof Error ? e.message : e}`, id)
      .run();
  }
  return id;
}

/** Cron：启动到期的计划，并推进 next_run_at */
export async function runDuePlans(env: Env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT * FROM insight_plans WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? LIMIT 20",
  )
    .bind(now)
    .all<PlanRow>();
  for (const plan of results) {
    // 先推进时间，避免同一个计划被下一次 Cron 重复触发
    const res = await env.DB.prepare(
      "UPDATE insight_plans SET next_run_at = ?, last_run_at = ? WHERE id = ? AND next_run_at = ?",
    )
      .bind(nextRun(plan.cron, plan.timezone), now, plan.id, plan.next_run_at)
      .run();
    if (!res.meta.changes) continue;
    try {
      await startInsight(env, plan.user_id, planConfig(plan), now);
    } catch (e) {
      console.error("insight start failed", plan.id, e);
    }
  }
}

interface InsightRow {
  id: string;
  plan_id: string | null;
  plan_name: string | null;
  status: string;
  title: string | null;
  content: string | null;
  period_start: number;
  period_end: number;
  memo_count: number;
  model: string | null;
  error: string | null;
  feedback: string | null;
  read_at: number | null;
  saved_memo_id: string | null;
  created_at: number;
  completed_at: number | null;
}

function toInsight(r: InsightRow, withContent = false) {
  return {
    id: r.id,
    planId: r.plan_id,
    planName: r.plan_name,
    status: r.status,
    title: r.title,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    memoCount: r.memo_count,
    model: r.model,
    error: r.error,
    feedback: r.feedback,
    readAt: r.read_at,
    savedMemoId: r.saved_memo_id,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    ...(withContent ? { content: r.content ? (JSON.parse(r.content) as InsightContent) : null } : {}),
  };
}

export async function listInsights(db: D1Database, userId: string, limit = 30) {
  const [list, unread] = await db.batch([
    db
      .prepare(
        `SELECT id, plan_id, plan_name, status, title, NULL AS content, period_start, period_end, memo_count, model, error,
                feedback, read_at, saved_memo_id, created_at, completed_at
           FROM insights WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(userId, limit),
    db.prepare("SELECT COUNT(*) AS n FROM insights WHERE user_id = ? AND status = 'ready' AND read_at IS NULL").bind(userId),
  ]);
  return {
    insights: (list.results as unknown as InsightRow[]).map((r) => toInsight(r)),
    unread: (unread.results[0] as { n: number }).n,
  };
}

export async function getInsight(db: D1Database, userId: string, id: string) {
  const row = await db.prepare("SELECT * FROM insights WHERE id = ? AND user_id = ?").bind(id, userId).first<InsightRow>();
  return row ? toInsight(row, true) : null;
}

export const insights = new Hono<AppEnv>();

insights.onError((err, c) => {
  if (err instanceof PlanError) return c.json({ error: err.message }, 400);
  throw err;
});

// ---------- 计划 ----------

insights.get("/insights/plans", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM insight_plans WHERE user_id = ? ORDER BY created_at")
    .bind(c.get("user").id)
    .all<PlanRow>();
  return c.json({ plans: results.map(toPlan) });
});

insights.post("/insights/plans", requireUser, async (c) => {
  const p = parsePlanInput(await c.req.json());
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO insight_plans (id, user_id, name, cadence, cron, timezone, scope_tags, window_days, perspective, extra_prompt,
       model, enabled, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, c.get("user").id, p.name, p.cadence, p.cron, p.timezone, p.scope_tags, p.window_days, p.perspective,
      p.extra_prompt, p.model, p.enabled, p.next_run_at, now, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM insight_plans WHERE id = ?").bind(id).first<PlanRow>();
  return c.json({ plan: toPlan(row!) }, 201);
});

insights.patch("/insights/plans/:id", requireUser, async (c) => {
  const userId = c.get("user").id;
  const prev = await c.env.DB.prepare("SELECT * FROM insight_plans WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .first<PlanRow>();
  if (!prev) return c.json({ error: "不存在" }, 404);
  const p = parsePlanInput(await c.req.json(), prev);
  await c.env.DB.prepare(
    `UPDATE insight_plans SET name = ?, cadence = ?, cron = ?, timezone = ?, scope_tags = ?, window_days = ?, perspective = ?,
       extra_prompt = ?, model = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(p.name, p.cadence, p.cron, p.timezone, p.scope_tags, p.window_days, p.perspective, p.extra_prompt, p.model,
      p.enabled, p.next_run_at, Date.now(), prev.id)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM insight_plans WHERE id = ?").bind(prev.id).first<PlanRow>();
  return c.json({ plan: toPlan(row!) });
});

insights.delete("/insights/plans/:id", requireUser, async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM insight_plans WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  if (!res.meta.changes) return c.json({ error: "不存在" }, 404);
  return c.json({ ok: true });
});

/** 立即生成 / 试运行 */
insights.post("/insights/plans/:id/run", requireUser, async (c) => {
  const userId = c.get("user").id;
  const plan = await c.env.DB.prepare("SELECT * FROM insight_plans WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .first<PlanRow>();
  if (!plan) return c.json({ error: "不存在" }, 404);
  const running = await c.env.DB.prepare(
    "SELECT id FROM insights WHERE plan_id = ? AND status = 'generating' AND created_at > ?",
  )
    .bind(plan.id, Date.now() - 30 * 60_000)
    .first<{ id: string }>();
  if (running) return c.json({ id: running.id, alreadyRunning: true });
  return c.json({ id: await startInsight(c.env, userId, planConfig(plan)) }, 201);
});

// ---------- 报告 ----------

insights.get("/insights", requireScope("insights:read"), async (c) =>
  c.json(await listInsights(c.env.DB, c.get("user").id, Math.min(Number(c.req.query("limit")) || 30, 100))),
);

insights.get("/insights/:id", requireScope("insights:read"), async (c) => {
  const userId = c.get("user").id;
  const insight = await getInsight(c.env.DB, userId, c.req.param("id"));
  if (!insight) return c.json({ error: "不存在" }, 404);
  // 网页打开即标记已读；Token 调用不改变已读状态
  if (c.get("auth").kind === "session" && insight.status === "ready" && !insight.readAt) {
    await c.env.DB.prepare("UPDATE insights SET read_at = ? WHERE id = ?").bind(Date.now(), insight.id).run();
  }
  return c.json({ insight });
});

insights.post("/insights/:id/feedback", requireUser, async (c) => {
  const { feedback } = await c.req.json<{ feedback?: string | null }>();
  if (feedback !== null && feedback !== "useful" && feedback !== "useless") return c.json({ error: "反馈不正确" }, 400);
  const res = await c.env.DB.prepare("UPDATE insights SET feedback = ? WHERE id = ? AND user_id = ?")
    .bind(feedback, c.req.param("id"), c.get("user").id)
    .run();
  if (!res.meta.changes) return c.json({ error: "不存在" }, 404);
  return c.json({ ok: true });
});

/** 存为 memo：让洞察也能被搜索和关联 */
insights.post("/insights/:id/save", requireUser, async (c) => {
  const user = c.get("user");
  const insight = await getInsight(c.env.DB, user.id, c.req.param("id"));
  if (!insight || insight.status !== "ready" || !insight.content) return c.json({ error: "报告还没有生成" }, 400);
  if (insight.savedMemoId) return c.json({ memoId: insight.savedMemoId, already: true });
  const memo = await createMemo(c.env.DB, user.id, reportToMarkdown(insight.title ?? "洞察", insight.content), "web");
  scheduleIndex(c.env, c.executionCtx, user.id, memo);
  await c.env.DB.prepare("UPDATE insights SET saved_memo_id = ? WHERE id = ?").bind(memo.id, insight.id).run();
  return c.json({ memoId: memo.id }, 201);
});

insights.delete("/insights/:id", requireUser, async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM insights WHERE id = ? AND user_id = ? AND status != 'generating'")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  if (!res.meta.changes) return c.json({ error: "不存在或正在生成" }, 404);
  return c.json({ ok: true });
});

// ---------- 模型设置 ----------

insights.get("/settings/ai", requireUser, async (c) => {
  const row = await c.env.DB.prepare("SELECT anthropic_key_enc FROM user_settings WHERE user_id = ?")
    .bind(c.get("user").id)
    .first<{ anthropic_key_enc: string | null }>();
  return c.json({ hasClaudeKey: !!row?.anthropic_key_enc, workersAiModel: WORKERS_AI_MODEL, claudeModel: CLAUDE_MODEL });
});

insights.put("/settings/ai", requireUser, async (c) => {
  const { anthropicKey } = await c.req.json<{ anthropicKey?: string | null }>();
  const key = typeof anthropicKey === "string" ? anthropicKey.trim() : null;
  if (key !== null && !/^sk-ant-[\w-]{20,}$/.test(key)) return c.json({ error: "API key 格式不正确（应以 sk-ant- 开头）" }, 400);
  const enc = key ? await seal(c.env.ENCRYPTION_KEY, key) : null;
  await c.env.DB.prepare(
    `INSERT INTO user_settings (user_id, anthropic_key_enc, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET anthropic_key_enc = excluded.anthropic_key_enc, updated_at = excluded.updated_at`,
  )
    .bind(c.get("user").id, enc, Date.now())
    .run();
  return c.json({ hasClaudeKey: !!enc });
});
