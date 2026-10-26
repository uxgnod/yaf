// memo 的读写逻辑。REST 接口（memos.ts）和 MCP（mcp.ts）共用。
import { extractTags } from "../shared/tags";
import type { Source } from "./env";
import { ftsStatements } from "./search";
import { LENSES, lensByKey } from "./lenses";

export interface MemoRow {
  id: string;
  content: string;
  source: string;
  created_at: number;
  updated_at: number;
  tags: string | null;
  attachments?: string | null;
  is_private?: number;
  masked_content?: string | null;
  judged_rev?: number | null;
  labels?: string | null;
}

/** owner：网页会话，能看到全部（隐私 memo 返回遮挡文本）；token：CLI / API / MCP，看不到隐私和还没判定的 memo */
export type Visibility = "owner" | "token";

/** 隐私 memo 的可公开文本；遮挡还没算出来时整条遮住 */
export const MASKED_SQL = "(CASE WHEN m.is_private = 1 THEN COALESCE(m.masked_content, '••••') ELSE m.content END)";

export interface Attachment {
  id: string;
  kind: "image" | "voice";
  mime: string | null;
  durationMs: number | null;
  description: string | null;
  hasFile: boolean;
  playable: boolean;
}

export type Memo = ReturnType<typeof toMemo>;

export const MAX_LEN = 20_000;

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

/** 卡片上的视图状态：命中的视图、拿不准要问用户的视图 */
function lensState(r: MemoRow) {
  const raw = r.labels ? (JSON.parse(r.labels) as Record<string, [number, string]>) : {};
  const lenses: string[] = [];
  const ask: string[] = [];
  for (const lens of LENSES) {
    if (lens.key === "private") continue; // 由 is_private 表示
    const v = raw[lens.key];
    if (!v) continue;
    const [score, source] = v;
    if (source === "user") {
      if (score >= 0.5) lenses.push(lens.key);
    } else if (score >= lens.threshold) lenses.push(lens.key);
    else if (lens.ask !== undefined && score >= lens.ask) ask.push(lens.key);
  }
  return { lenses, ask };
}

/** raw = true 时返回原文（只给网页会话的取原文 / 导出原文用） */
export function toMemo(r: MemoRow, opts: { raw?: boolean } = {}) {
  const isPrivate = r.is_private === 1;
  return {
    id: r.id,
    content: isPrivate && !opts.raw ? (r.masked_content ?? "••••") : r.content,
    private: isPrivate,
    judged: r.judged_rev != null,
    ...lensState(r),
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: r.tags ? r.tags.split("\u001f").sort() : [],
    attachments: r.attachments ? (JSON.parse(r.attachments) as Attachment[]) : [],
  };
}

/** 视图筛选：private 看 is_private；其他视图看 memo_labels（用户改过的优先） */
export function lensFilter(key: string): { sql: string; params: unknown[] } | null {
  const lens = lensByKey(key);
  if (!lens) return null;
  if (lens.key === "private") return { sql: "m.is_private = 1", params: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM memo_labels l WHERE l.memo_id = m.id AND l.label = ?
            AND ((l.source = 'user' AND l.score >= 0.5) OR (l.source = 'model' AND l.score >= ?)))`,
    params: [lens.key, lens.threshold],
  };
}

/** Token 看不到隐私和还没判定的 memo */
export const TOKEN_VISIBLE_SQL = "m.is_private = 0 AND m.judged_rev IS NOT NULL";

/** 构造 WHERE 子句：搜索关键词（空格分隔，全部命中，隐私 memo 只匹配遮挡文本）+ 标签（含子标签）+ 视图 */
export function buildFilter(
  userId: string,
  q?: string,
  tag?: string,
  opts: { lens?: string; visibility?: Visibility } = {},
) {
  const where = ["m.user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.visibility === "token") where.push(TOKEN_VISIBLE_SQL);
  for (const word of (q ?? "").trim().split(/\s+/).filter(Boolean)) {
    where.push(`${MASKED_SQL} LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(word)}%`);
  }
  if (opts.lens) {
    const lf = lensFilter(opts.lens);
    if (lf) {
      where.push(lf.sql);
      params.push(...lf.params);
    }
  }
  const t = tag?.trim().replace(/^#/, "");
  if (t) {
    where.push(
      "EXISTS (SELECT 1 FROM memo_tags t WHERE t.memo_id = m.id AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))",
    );
    params.push(t, `${escapeLike(t)}/%`);
  }
  return { sql: where.join(" AND "), params };
}

export const SELECT_MEMO = `SELECT m.id, m.content, m.source, m.created_at, m.updated_at,
  m.is_private, m.masked_content, m.judged_rev,
  (SELECT json_group_object(label, json_array(score, source)) FROM memo_labels WHERE memo_id = m.id) AS labels,
  (SELECT group_concat(tag, char(31)) FROM memo_tags WHERE memo_id = m.id) AS tags,
  (SELECT json_group_array(json_object('id', a.id, 'kind', a.kind, 'mime', a.mime, 'durationMs', a.duration_ms,
      'description', a.description, 'hasFile', json(CASE WHEN a.r2_key IS NULL THEN 'false' ELSE 'true' END),
      'playable', json(CASE WHEN a.playback_key IS NULL THEN 'false' ELSE 'true' END)))
     FROM attachments a WHERE a.memo_id = m.id) AS attachments
  FROM memos m`;

function tagStatements(db: D1Database, memoId: string, userId: string, content: string) {
  return [
    db.prepare("DELETE FROM memo_tags WHERE memo_id = ?").bind(memoId),
    ...extractTags(content).map((tag) =>
      db.prepare("INSERT INTO memo_tags (memo_id, user_id, tag) VALUES (?, ?, ?)").bind(memoId, userId, tag),
    ),
  ];
}

export class MemoError extends Error {
  constructor(
    public status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

/** allowEmpty：带附件的 memo（如微信纯图片、无转写的语音）正文可以为空 */
function checkContent(content: unknown, allowEmpty = false): string {
  const text = String(content ?? "").trim();
  if (!text && !allowEmpty) throw new MemoError(400, "内容不能为空");
  if (text.length > MAX_LEN) throw new MemoError(400, "内容过长");
  return text;
}

export async function listMemos(
  db: D1Database,
  userId: string,
  opts: { q?: string; tag?: string; lens?: string; cursor?: string | null; limit?: number; visibility?: Visibility },
) {
  const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
  const f = buildFilter(userId, opts.q, opts.tag, { lens: opts.lens, visibility: opts.visibility });
  if (opts.cursor) {
    // cursor = "<created_at>_<id>"，按 (created_at, id) 倒序翻页
    const [ts, id] = opts.cursor.split("_");
    f.sql += " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))";
    f.params.push(Number(ts), Number(ts), id);
  }
  const { results } = await db
    .prepare(`${SELECT_MEMO} WHERE ${f.sql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
    .bind(...f.params, limit + 1)
    .all<MemoRow>();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    memos: page.map((r) => toMemo(r)),
    nextCursor: results.length > limit && last ? `${last.created_at}_${last.id}` : null,
  };
}

export async function getMemo(
  db: D1Database,
  userId: string,
  id: string,
  opts: { visibility?: Visibility; raw?: boolean } = {},
) {
  const extra = opts.visibility === "token" ? ` AND ${TOKEN_VISIBLE_SQL}` : "";
  const row = await db
    .prepare(`${SELECT_MEMO} WHERE m.id = ? AND m.user_id = ?${extra}`)
    .bind(id, userId)
    .first<MemoRow>();
  return row ? toMemo(row, { raw: opts.raw }) : null;
}

export async function createMemo(
  db: D1Database,
  userId: string,
  content: unknown,
  source: Source,
  opts: { allowEmpty?: boolean } = {},
) {
  const text = checkContent(content, opts.allowEmpty);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO memos (id, user_id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, userId, text, source, now, now),
    ...tagStatements(db, id, userId, text),
    ...ftsStatements(db, id, userId, text),
  ]);
  return {
    id,
    content: text,
    private: false,
    judged: false,
    lenses: [],
    ask: [],
    source,
    createdAt: now,
    updatedAt: now,
    tags: extractTags(text).sort(),
    attachments: [],
  } as Memo;
}

export async function updateMemo(db: D1Database, userId: string, id: string, content: unknown) {
  const existing = await db
    .prepare(
      "SELECT created_at, source, is_private, EXISTS (SELECT 1 FROM attachments WHERE memo_id = m.id) AS has_att FROM memos m WHERE id = ? AND user_id = ?",
    )
    .bind(id, userId)
    .first<{ created_at: number; source: string; is_private: number; has_att: number }>();
  if (!existing) throw new MemoError(404, "不存在");
  const text = checkContent(content, existing.has_att === 1);
  const now = Date.now();
  await db.batch([
    db
      .prepare("UPDATE memos SET content = ?, updated_at = ?, vector_hash = NULL, judged_rev = NULL WHERE id = ? AND user_id = ?")
      .bind(text, now, id, userId),
    ...tagStatements(db, id, userId, text),
    // 原来是隐私 memo：重新判定前不把原文写进全文索引（保留旧的遮挡文本）
    ...(existing.is_private ? [] : ftsStatements(db, id, userId, text)),
  ]);
  const isPrivate = existing.is_private === 1;
  return {
    id,
    content: isPrivate ? ((await maskedOf(db, id)) ?? "••••") : text,
    private: isPrivate,
    judged: false,
    lenses: [],
    ask: [],
    source: existing.source,
    createdAt: existing.created_at,
    updatedAt: now,
    tags: extractTags(text).sort(),
    attachments: await listAttachments(db, id),
  } as Memo;
}

async function maskedOf(db: D1Database, memoId: string) {
  const row = await db.prepare("SELECT masked_content FROM memos WHERE id = ?").bind(memoId).first<{ masked_content: string | null }>();
  return row?.masked_content ?? null;
}

async function listAttachments(db: D1Database, memoId: string) {
  const row = await db.prepare(`${SELECT_MEMO} WHERE m.id = ?`).bind(memoId).first<MemoRow>();
  return row ? toMemo(row).attachments : [];
}

/** 删除 memo；返回需要从 R2 删除的文件 key */
export async function deleteMemo(db: D1Database, userId: string, id: string): Promise<string[]> {
  const { results: files } = await db
    .prepare("SELECT r2_key, playback_key FROM attachments WHERE memo_id = ? AND user_id = ?")
    .bind(id, userId)
    .all<{ r2_key: string | null; playback_key: string | null }>();
  const res = await db.batch([
    db.prepare("DELETE FROM memo_tags WHERE memo_id = ? AND user_id = ?").bind(id, userId),
    db.prepare("DELETE FROM memos_fts WHERE memo_id = ? AND user_id = ?").bind(id, userId),
    db.prepare("DELETE FROM memo_labels WHERE memo_id = ? AND user_id = ?").bind(id, userId),
    db.prepare("DELETE FROM attachments WHERE memo_id = ? AND user_id = ?").bind(id, userId),
    db.prepare("DELETE FROM memos WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  if (!res[4].meta.changes) throw new MemoError(404, "不存在");
  return files.flatMap((f) => [f.r2_key, f.playback_key]).filter((k): k is string => !!k);
}

export async function listTags(db: D1Database, userId: string) {
  const { results } = await db
    .prepare("SELECT tag, COUNT(*) AS count FROM memo_tags WHERE user_id = ? GROUP BY tag ORDER BY tag")
    .bind(userId)
    .all<{ tag: string; count: number }>();
  return results;
}

/** 各视图的条数（侧栏用） */
export async function lensCounts(db: D1Database, userId: string) {
  const out: { key: string; name: string; count: number }[] = [];
  for (const lens of LENSES) {
    const lf = lensFilter(lens.key)!;
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM memos m WHERE m.user_id = ? AND ${lf.sql}`)
      .bind(userId, ...lf.params)
      .first<{ n: number }>();
    out.push({ key: lens.key, name: lens.name, count: row?.n ?? 0 });
  }
  return out;
}
