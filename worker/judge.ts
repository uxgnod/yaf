// 视图判定：一次 Clef 调用回答所有视图的问题；命中「隐私」时再逐行遮挡。
// Clef 是 Workers AI 的 System One 决策模型：只返回每个问题的概率，不生成文本。
import type { Env } from "./env";
import { LENS_REV, LENSES } from "./lenses";
import { ftsStatements } from "./search";

export const CLEF_MODEL = "@cf/cloudflare/clef-flash";
const MAX_QUESTIONS = 64;
const STATE_MAX_CHARS = 12_000;
/** 一行被判为写出了凭据值的概率阈值（宁可多遮） */
const LINE_MASK_MIN = 0.3;
const MASK = "••••";
/** 像密钥的串：同时含字母和数字、8 位以上 */
const SECRETY = /(?=\S*[A-Za-z])(?=\S*\d)[\w!@#$%^&*/+\-=.]{8,}/;

type Questions = Record<string, { type: "noul"; instructions: string }>;

async function askClef(env: Env, state: string, questions: Questions): Promise<Record<string, number>> {
  const res = (await env.AI.run(CLEF_MODEL as keyof AiModels, {
    model: "clef-flash",
    state: state.slice(0, STATE_MAX_CHARS),
    questions,
  } as never)) as { answers?: Record<string, { noul?: number }> };
  if (!res?.answers) throw new Error("clef: no answers");
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(res.answers)) out[k] = typeof v.noul === "number" ? v.noul : 0;
  return out;
}

/** 遮挡一行：保留第一个分隔符及之前的标签（标签本身不像密钥且不长），其余换成 •••• */
export function maskLine(line: string): string {
  const m = line.match(/^(\s*[-*+]?\s*)([^：:=]{1,24}?)\s*([：:=])/);
  if (m && !SECRETY.test(m[2])) return `${m[1]}${m[2]}${m[3]} ${MASK}`;
  const indent = line.match(/^\s*[-*+]?\s*/)?.[0] ?? "";
  return indent + MASK;
}

/** 逐行判断是否写出了凭据的值，命中的行遮挡；超过 64 个非空行时，多出的行一律遮挡 */
export async function maskPrivate(env: Env, content: string): Promise<string> {
  const lines = content.split("\n");
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const asked = idx.slice(0, MAX_QUESTIONS);
  const state = asked.map((i) => `L${i + 1}: ${lines[i]}`).join("\n");
  const questions: Questions = {};
  for (const i of asked) {
    questions[`L${i + 1}`] = {
      type: "noul",
      instructions: `L${i + 1} 这一行是否写出了某个凭据的值（密码、口令、API key、secret、token、恢复码、私钥）？只有网站名、用户名、说明文字的不算。`,
    };
  }
  const probs = asked.length ? await askClef(env, state, questions) : {};
  const askedSet = new Set(asked);
  return lines
    .map((l, i) => {
      if (!l.trim()) return l;
      const p = askedSet.has(i) ? (probs[`L${i + 1}`] ?? 1) : 1;
      // 模型漏判时兜底：像密钥的串且概率不是极低
      if (p >= LINE_MASK_MIN || (SECRETY.test(l) && p >= 0.05)) return maskLine(l);
      return l;
    })
    .join("\n");
}

interface JudgeRow {
  id: string;
  user_id: string;
  content: string;
}

/** 判定一条 memo，写入 memo_labels / is_private / masked_content；返回是否隐私（内容已被修改时返回 null） */
export async function judgeMemo(env: Env, row: JudgeRow): Promise<{ private: boolean } | null> {
  const { results: atts } = await env.DB.prepare("SELECT description FROM attachments WHERE memo_id = ? AND description IS NOT NULL")
    .bind(row.id)
    .all<{ description: string }>();
  const state = [row.content, ...atts.map((a) => `[附件] ${a.description}`)].join("\n").trim();

  const questions: Questions = {};
  for (const lens of LENSES) questions[lens.key] = { type: "noul", instructions: lens.question };
  const scores = state ? await askClef(env, state, questions) : Object.fromEntries(LENSES.map((l) => [l.key, 0]));

  const userPrivate = await env.DB.prepare(
    "SELECT score FROM memo_labels WHERE memo_id = ? AND label = 'private' AND source = 'user'",
  )
    .bind(row.id)
    .first<{ score: number }>();
  const privateLens = LENSES.find((l) => l.key === "private")!;
  const isPrivate = userPrivate ? userPrivate.score >= 0.5 : (scores.private ?? 0) >= privateLens.threshold;
  const masked = isPrivate ? await maskPrivate(env, row.content) : null;

  const now = Date.now();
  const res = await env.DB.batch([
    // 先更新 memo：正文已被再次修改（content 不一致）时整批作废
    env.DB.prepare(
      "UPDATE memos SET judged_rev = ?, is_private = ?, masked_content = ? WHERE id = ? AND content = ?",
    ).bind(LENS_REV, isPrivate ? 1 : 0, masked, row.id, row.content),
    ...LENSES.map((l) =>
      env.DB.prepare(
        `INSERT INTO memo_labels (memo_id, user_id, label, score, source, rev, updated_at)
         SELECT ?1, ?2, ?3, ?4, 'model', ?5, ?6 WHERE EXISTS (SELECT 1 FROM memos WHERE id = ?1 AND content = ?7)
         ON CONFLICT(memo_id, label) DO UPDATE SET score = excluded.score, rev = excluded.rev, updated_at = excluded.updated_at
         WHERE memo_labels.source = 'model'`,
      ).bind(row.id, row.user_id, l.key, scores[l.key] ?? 0, LENS_REV, now, row.content),
    ),
  ]);
  if (!res[0].meta.changes) return null;
  if (isPrivate) await applyPrivate(env, row.id, row.user_id, masked!);
  return { private: isPrivate };
}

/** 隐私 memo：全文索引只放遮挡文本，删除已有向量 */
export async function applyPrivate(env: Env, memoId: string, userId: string, masked: string) {
  await env.DB.batch([
    ...ftsStatements(env.DB, memoId, userId, masked),
    env.DB.prepare("UPDATE memos SET vector_hash = NULL WHERE id = ?").bind(memoId),
  ]);
  await env.VECTORS.deleteByIds([memoId]).catch((e) => console.error("vector delete failed", memoId, e));
}

const BACKFILL_LIMIT = 60;
const CONCURRENCY = 4;

/** 定时任务：判定还没判定或视图版本过期的 memo（每次有上限，剩下的下次再做） */
export async function judgeBackfill(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, content FROM memos WHERE judged_rev IS NULL OR judged_rev < ? ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(LENS_REV, BACKFILL_LIMIT)
    .all<JudgeRow>();
  let next = 0;
  const worker = async () => {
    while (next < results.length) {
      const row = results[next++];
      try {
        await judgeMemo(env, row);
      } catch (e) {
        console.error("judge failed", row.id, e);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results.length;
}
