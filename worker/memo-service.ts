// memo 的读写逻辑。REST 接口（memos.ts）和 MCP（mcp.ts）共用。
import { extractTags } from "../shared/tags";
import type { Source } from "./env";

export interface MemoRow {
  id: string;
  content: string;
  source: string;
  created_at: number;
  updated_at: number;
  tags: string | null;
}

export type Memo = ReturnType<typeof toMemo>;

export const MAX_LEN = 20_000;

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

export function toMemo(r: MemoRow) {
  return {
    id: r.id,
    content: r.content,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: r.tags ? r.tags.split("\u001f").sort() : [],
  };
}

/** 构造 WHERE 子句：搜索关键词（空格分隔，全部命中）+ 标签（含子标签） */
export function buildFilter(userId: string, q?: string, tag?: string) {
  const where = ["m.user_id = ?"];
  const params: unknown[] = [userId];
  for (const word of (q ?? "").trim().split(/\s+/).filter(Boolean)) {
    where.push("m.content LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(word)}%`);
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
  (SELECT group_concat(tag, char(31)) FROM memo_tags WHERE memo_id = m.id) AS tags
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

function checkContent(content: unknown): string {
  const text = String(content ?? "").trim();
  if (!text) throw new MemoError(400, "内容不能为空");
  if (text.length > MAX_LEN) throw new MemoError(400, "内容过长");
  return text;
}

export async function listMemos(
  db: D1Database,
  userId: string,
  opts: { q?: string; tag?: string; cursor?: string | null; limit?: number },
) {
  const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
  const f = buildFilter(userId, opts.q, opts.tag);
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
    memos: page.map(toMemo),
    nextCursor: results.length > limit && last ? `${last.created_at}_${last.id}` : null,
  };
}

export async function getMemo(db: D1Database, userId: string, id: string) {
  const row = await db.prepare(`${SELECT_MEMO} WHERE m.id = ? AND m.user_id = ?`).bind(id, userId).first<MemoRow>();
  return row ? toMemo(row) : null;
}

export async function createMemo(db: D1Database, userId: string, content: unknown, source: Source) {
  const text = checkContent(content);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO memos (id, user_id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, userId, text, source, now, now),
    ...tagStatements(db, id, userId, text),
  ]);
  return { id, content: text, source, createdAt: now, updatedAt: now, tags: extractTags(text).sort() } as Memo;
}

export async function updateMemo(db: D1Database, userId: string, id: string, content: unknown) {
  const text = checkContent(content);
  const existing = await db
    .prepare("SELECT created_at, source FROM memos WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ created_at: number; source: string }>();
  if (!existing) throw new MemoError(404, "不存在");
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE memos SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(text, now, id, userId),
    ...tagStatements(db, id, userId, text),
  ]);
  return {
    id,
    content: text,
    source: existing.source,
    createdAt: existing.created_at,
    updatedAt: now,
    tags: extractTags(text).sort(),
  } as Memo;
}

export async function deleteMemo(db: D1Database, userId: string, id: string) {
  const res = await db.batch([
    db.prepare("DELETE FROM memo_tags WHERE memo_id = ? AND user_id = ?").bind(id, userId),
    db.prepare("DELETE FROM memos WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  if (!res[1].meta.changes) throw new MemoError(404, "不存在");
}

export async function listTags(db: D1Database, userId: string) {
  const { results } = await db
    .prepare("SELECT tag, COUNT(*) AS count FROM memo_tags WHERE user_id = ? GROUP BY tag ORDER BY tag")
    .bind(userId)
    .all<{ tag: string; count: number }>();
  return results;
}
