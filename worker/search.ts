// 混合检索：D1 FTS5（先切词）+ Workers AI bge-m3 向量（Vectorize），用 RRF 按名次融合。
import { queryTerms, segmentWords } from "../shared/segment";
import { extractTags } from "../shared/tags";
import type { Env } from "./env";
import { sha256 } from "./lib/crypto";
import { escapeLike, MASKED_SQL, SELECT_MEMO, TOKEN_VISIBLE_SQL, toMemo, type Memo, type MemoRow, type Visibility } from "./memo-service";
import { judgeMemo } from "./judge";

export const EMBED_MODEL = "@cf/baai/bge-m3";
const RRF_K = 60;
const CANDIDATES = 30;
// bge-m3 的 cosine 分数：无关文本通常在 0.3–0.45，低于阈值的语义结果丢弃
export const SEMANTIC_MIN = 0.53;
export const RELATED_MIN = 0.55;
const EMBED_MAX_CHARS = 2000;

export type SearchMode = "hybrid" | "keyword" | "semantic";
export type SearchSort = "relevance" | "time";
export interface Match {
  keywordRank?: number;
  semanticScore?: number;
}

/** 去掉 Markdown 语法，保留可读文字；用于全文索引和算向量 */
export function plainText(content: string): string {
  return content
    .replace(/```[a-zA-Z0-9_-]*\n?/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/gm, "")
    .replace(/[*_~`|]+/g, " ")
    .replace(/(^|\s)#(?=\S)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 算向量的文本：标签拼在前面 */
export function embedText(content: string): string {
  const tags = extractTags(content);
  const body = plainText(content);
  return ((tags.length ? `标签：${tags.join(" ")}\n` : "") + body).slice(0, EMBED_MAX_CHARS);
}

/** 写入 FTS 的语句（先删后插），和 memo 写入放在同一个 batch 里 */
export function ftsStatements(db: D1Database, memoId: string, userId: string, content: string) {
  return [
    db.prepare("DELETE FROM memos_fts WHERE memo_id = ?").bind(memoId),
    db
      .prepare("INSERT INTO memos_fts (body, memo_id, user_id) VALUES (?, ?, ?)")
      .bind(segmentWords(plainText(content)).join(" "), memoId, userId),
  ];
}

/** 同 ftsStatements，但只在 memo 仍然不是隐私时生效（后台任务写入时 memo 可能刚被标为隐私） */
function publicFtsStatements(db: D1Database, memoId: string, userId: string, content: string) {
  const guard = "EXISTS (SELECT 1 FROM memos WHERE id = ? AND is_private = 0)";
  return [
    db.prepare(`DELETE FROM memos_fts WHERE memo_id = ? AND ${guard}`).bind(memoId, memoId),
    db
      .prepare(`INSERT INTO memos_fts (body, memo_id, user_id) SELECT ?, ?, ? WHERE ${guard}`)
      .bind(segmentWords(plainText(content)).join(" "), memoId, userId, memoId),
  ];
}

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
  if (!res.data || res.data.length !== texts.length) throw new Error("embedding failed");
  return res.data;
}

interface IndexRow {
  id: string;
  user_id: string;
  content: string;
  created_at: number;
}

/** 给一批 memo 算向量、写 Vectorize，并同步 FTS；成功后记下 vector_hash */
export async function indexMemos(env: Env, input: IndexRow[]) {
  if (!input.length) return;
  // 隐私 memo 不算向量，全文索引由 judge 写遮挡文本
  const { results: ok } = await env.DB.prepare(
    `SELECT id FROM memos WHERE is_private = 0 AND id IN (${input.map(() => "?").join(",")})`,
  )
    .bind(...input.map((r) => r.id))
    .all<{ id: string }>();
  const okIds = new Set(ok.map((r) => r.id));
  const rows = input.filter((r) => okIds.has(r.id));
  if (!rows.length) return;
  // 图片描述 / 语音转写也参与检索
  const { results: atts } = await env.DB.prepare(
    `SELECT memo_id, description FROM attachments
      WHERE description IS NOT NULL AND memo_id IN (${rows.map(() => "?").join(",")})`,
  )
    .bind(...rows.map((r) => r.id))
    .all<{ memo_id: string; description: string }>();
  const extra = new Map<string, string>();
  for (const a of atts) extra.set(a.memo_id, `${extra.get(a.memo_id) ?? ""}\n${a.description}`);
  const texts = rows.map((r) => embedText(r.content + (extra.get(r.id) ?? "")));
  // 没有任何文字的 memo（如没有转写的语音）不算向量，但照样标记为已索引，避免补算任务反复重试
  const withText = rows.map((_, i) => i).filter((i) => texts[i].trim());
  if (withText.length) {
    const vectors = await embed(env, withText.map((i) => texts[i]));
    await env.VECTORS.upsert(
      withText.map((i, k) => ({ id: rows[i].id, values: vectors[k], metadata: { userId: rows[i].user_id, createdAt: rows[i].created_at } })),
    );
  }
  const hashes = await Promise.all(texts.map((t) => sha256(t)));
  await env.DB.batch(
    rows.flatMap((r, i) => [
      ...publicFtsStatements(env.DB, r.id, r.user_id, r.content + (extra.get(r.id) ?? "")),
      // 只有内容没被再次修改时才标记为已索引
      env.DB.prepare("UPDATE memos SET vector_hash = ? WHERE id = ? AND content = ? AND is_private = 0").bind(hashes[i], r.id, r.content),
    ]),
  );
  // 算向量期间被标为隐私的：删掉刚写入的向量
  if (withText.length) {
    const ids = withText.map((i) => rows[i].id);
    const { results: turned } = await env.DB.prepare(
      `SELECT id FROM memos WHERE is_private = 1 AND id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ id: string }>();
    if (turned.length) await env.VECTORS.deleteByIds(turned.map((r) => r.id));
  }
}

/** 新建 / 编辑后在后台先判定视图，非隐私再算向量（失败也没关系，定时任务会补做） */
export function scheduleIndex(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, userId: string, memo: Memo) {
  ctx.waitUntil(
    (async () => {
      // 从库里取原文：隐私 memo 返回给前端的 content 是遮挡文本
      const cur = await env.DB.prepare("SELECT content FROM memos WHERE id = ?").bind(memo.id).first<{ content: string }>();
      if (!cur) return;
      const row = { id: memo.id, user_id: userId, content: cur.content, created_at: memo.createdAt };
      const judged = await judgeMemo(env, row).catch((e) => {
        console.error("judge failed", memo.id, e);
        return null;
      });
      if (judged && !judged.private) await indexMemos(env, [row]);
    })().catch((e) => console.error("index failed", memo.id, e)),
  );
}

export function scheduleRemove(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, memoId: string) {
  ctx.waitUntil(env.VECTORS.deleteByIds([memoId]).catch((e) => console.error("vector delete failed", memoId, e)));
}

/** FTS5 查询串：每个词加引号做前缀匹配，词之间是 AND */
function ftsQuery(terms: string[]) {
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

async function keywordCandidates(env: Env, userId: string, q: string): Promise<string[]> {
  const terms = queryTerms(q);
  if (!terms.length) return [];
  const ids: string[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT memo_id FROM memos_fts WHERE memos_fts MATCH ? AND user_id = ? ORDER BY bm25(memos_fts) LIMIT ?`,
    )
      .bind(ftsQuery(terms), userId, CANDIDATES)
      .all<{ memo_id: string }>();
    ids.push(...results.map((r) => r.memo_id));
  } catch (e) {
    console.error("fts query failed", e);
  }
  // 兜底：切词和原文不一致、或还没进 FTS 的 memo，用子串匹配补上（排在 FTS 结果后面）
  const words = q.trim().split(/\s+/).filter(Boolean);
  const { results } = await env.DB.prepare(
    `SELECT m.id FROM memos m WHERE m.user_id = ? AND ${words.map(() => `${MASKED_SQL} LIKE ? ESCAPE '\\'`).join(" AND ")}
      ORDER BY m.created_at DESC LIMIT ?`,
  )
    .bind(userId, ...words.map((w) => `%${escapeLike(w)}%`), CANDIDATES)
    .all<{ id: string }>();
  const seen = new Set(ids);
  for (const r of results) if (!seen.has(r.id) && ids.length < CANDIDATES) ids.push(r.id), seen.add(r.id);
  return ids;
}

async function semanticCandidates(env: Env, userId: string, q: string) {
  const [vector] = await embed(env, [q.slice(0, EMBED_MAX_CHARS)]);
  const res = await env.VECTORS.query(vector, { topK: CANDIDATES, filter: { userId } });
  return res.matches.filter((m) => m.score >= SEMANTIC_MIN).map((m) => ({ id: m.id, score: m.score }));
}

async function fetchMemos(
  env: Env,
  userId: string,
  ids: string[],
  opts: { tag?: string; visibility?: Visibility; excludePrivate?: boolean } = {},
) {
  if (!ids.length) return new Map<string, Memo>();
  const tag = opts.tag;
  let sql = `${SELECT_MEMO} WHERE m.user_id = ? AND m.id IN (${ids.map(() => "?").join(",")})`;
  if (opts.visibility === "token") sql += ` AND ${TOKEN_VISIBLE_SQL}`;
  else if (opts.excludePrivate) sql += " AND m.is_private = 0";
  const params: unknown[] = [userId, ...ids];
  const t = tag?.trim().replace(/^#/, "");
  if (t) {
    sql += " AND EXISTS (SELECT 1 FROM memo_tags t WHERE t.memo_id = m.id AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))";
    params.push(t, `${escapeLike(t)}/%`);
  }
  const { results } = await env.DB.prepare(sql).bind(...params).all<MemoRow>();
  return new Map(results.map((r) => [r.id, toMemo(r)]));
}

export async function search(
  env: Env,
  userId: string,
  opts: { q: string; tag?: string; mode?: SearchMode; sort?: SearchSort; limit?: number; visibility?: Visibility },
) {
  const mode = opts.mode ?? "hybrid";
  const [kw, sem] = await Promise.all([
    mode === "semantic" ? [] : keywordCandidates(env, userId, opts.q),
    mode === "keyword"
      ? []
      : semanticCandidates(env, userId, opts.q).catch((e) => {
          // 语义检索失败时退化为关键词检索，不让整个搜索失败
          console.error("semantic search failed", e);
          return [] as { id: string; score: number }[];
        }),
  ]);

  const scores = new Map<string, number>();
  const match = new Map<string, Match>();
  kw.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    match.set(id, { ...match.get(id), keywordRank: i + 1 });
  });
  sem.forEach(({ id, score }, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    match.set(id, { ...match.get(id), semanticScore: Math.round(score * 100) / 100 });
  });

  const memos = await fetchMemos(env, userId, [...scores.keys()], { tag: opts.tag, visibility: opts.visibility });
  let list = [...memos.values()].map((m) => ({ ...m, match: match.get(m.id)!, score: scores.get(m.id)! }));
  list.sort((a, b) => (opts.sort === "time" ? b.createdAt - a.createdAt : b.score - a.score || b.createdAt - a.createdAt));
  list = list.slice(0, opts.limit ?? 50);
  return {
    memos: list.map(({ score: _, ...m }) => m),
    nextCursor: null,
    stats: {
      total: list.length,
      keyword: list.filter((m) => m.match.keywordRank).length,
      semantic: list.filter((m) => m.match.semanticScore).length,
    },
  };
}

/** 相关笔记：用 memo 自身的向量查最近邻，排除自己 */
export async function related(env: Env, userId: string, memoId: string, limit = 3, visibility: Visibility = "owner") {
  let matches: VectorizeMatch[];
  try {
    ({ matches } = await env.VECTORS.queryById(memoId, { topK: limit + 1, filter: { userId } }));
  } catch {
    return []; // 还没有向量
  }
  const hits = matches.filter((m) => m.id !== memoId && m.score >= RELATED_MIN).slice(0, limit);
  const memos = await fetchMemos(env, userId, hits.map((h) => h.id), { visibility, excludePrivate: true });
  return hits
    .filter((h) => memos.has(h.id))
    .map((h) => ({ ...memos.get(h.id)!, score: Math.round(h.score * 100) / 100 }));
}

// ---------- 索引状态 / 补算任务 ----------

export async function indexStatus(env: Env, userId: string) {
  const [counts, job] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, COUNT(vector_hash) AS indexed FROM memos WHERE user_id = ? AND is_private = 0")
      .bind(userId)
      .first<{ total: number; indexed: number }>(),
    env.DB.prepare("SELECT instance_id, started_at FROM index_jobs WHERE user_id = ?")
      .bind(userId)
      .first<{ instance_id: string; started_at: number }>(),
  ]);
  let running = false;
  let jobStatus: string | null = null;
  if (job) {
    try {
      jobStatus = (await (await env.INDEX_WORKFLOW.get(job.instance_id)).status()).status;
      running = ["queued", "running", "waiting", "paused"].includes(jobStatus);
    } catch {
      jobStatus = "unknown";
    }
  }
  return {
    total: counts?.total ?? 0,
    indexed: counts?.indexed ?? 0,
    running,
    jobStatus,
    jobStartedAt: job?.started_at ?? null,
    model: EMBED_MODEL,
    fusion: "RRF",
  };
}

/** 启动补算；full = true 时先清空该用户的向量状态（重建索引） */
export async function startIndexJob(env: Env, userId: string, full: boolean) {
  const status = await indexStatus(env, userId);
  if (status.running) return status;
  if (full) await env.DB.prepare("UPDATE memos SET vector_hash = NULL WHERE user_id = ?").bind(userId).run();
  const instance = await env.INDEX_WORKFLOW.create({ params: { userId } });
  await env.DB.prepare(
    `INSERT INTO index_jobs (user_id, instance_id, started_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET instance_id = excluded.instance_id, started_at = excluded.started_at`,
  )
    .bind(userId, instance.id, Date.now())
    .run();
  return indexStatus(env, userId);
}

/** 定时任务：给有未索引 memo（超过 5 分钟仍没向量）的用户启动补算 */
export async function backfillAll(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT user_id FROM memos WHERE vector_hash IS NULL AND judged_rev IS NOT NULL AND is_private = 0 AND updated_at < ?",
  )
    .bind(Date.now() - 5 * 60_000)
    .all<{ user_id: string }>();
  for (const { user_id } of results) {
    try {
      await startIndexJob(env, user_id, false);
    } catch (e) {
      console.error("backfill start failed", user_id, e);
    }
  }
}
