import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireUser } from "./auth";
import { extractTags } from "../shared/tags";

interface MemoRow {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  tags: string | null;
}

const MAX_LEN = 20_000;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

function toMemo(r: MemoRow) {
  return {
    id: r.id,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: r.tags ? r.tags.split("\u001f").sort() : [],
  };
}

/** 构造 WHERE 子句：搜索关键词（空格分隔，全部命中）+ 标签（含子标签） */
function buildFilter(userId: string, q?: string, tag?: string) {
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

const SELECT_MEMO = `SELECT m.id, m.content, m.created_at, m.updated_at,
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

export const memos = new Hono<AppEnv>();
for (const p of ["/memos", "/memos/*", "/tags", "/stats", "/export"]) memos.use(p, requireUser);

memos.get("/memos", async (c) => {
  const { q, tag, cursor } = c.req.query();
  const limit = Math.min(Number(c.req.query("limit")) || 30, 100);
  const f = buildFilter(c.get("user").id, q, tag);
  if (cursor) {
    // cursor = "<created_at>_<id>"，按 (created_at, id) 倒序翻页
    const [ts, id] = cursor.split("_");
    f.sql += " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))";
    f.params.push(Number(ts), Number(ts), id);
  }
  const { results } = await c.env.DB.prepare(
    `${SELECT_MEMO} WHERE ${f.sql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
  )
    .bind(...f.params, limit + 1)
    .all<MemoRow>();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({
    memos: page.map(toMemo),
    nextCursor: results.length > limit && last ? `${last.created_at}_${last.id}` : null,
  });
});

memos.post("/memos", async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  const text = String(content ?? "").trim();
  if (!text) return c.json({ error: "内容不能为空" }, 400);
  if (text.length > MAX_LEN) return c.json({ error: "内容过长" }, 400);
  const user = c.get("user");
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO memos (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(
      id,
      user.id,
      text,
      now,
      now,
    ),
    ...tagStatements(c.env.DB, id, user.id, text),
  ]);
  return c.json({ memo: { id, content: text, createdAt: now, updatedAt: now, tags: extractTags(text).sort() } }, 201);
});

memos.patch("/memos/:id", async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  const text = String(content ?? "").trim();
  if (!text) return c.json({ error: "内容不能为空" }, 400);
  if (text.length > MAX_LEN) return c.json({ error: "内容过长" }, 400);
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT created_at FROM memos WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first<{ created_at: number }>();
  if (!existing) return c.json({ error: "不存在" }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE memos SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(
      text,
      now,
      id,
      user.id,
    ),
    ...tagStatements(c.env.DB, id, user.id, text),
  ]);
  return c.json({
    memo: { id, content: text, createdAt: existing.created_at, updatedAt: now, tags: extractTags(text).sort() },
  });
});

memos.delete("/memos/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const res = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM memo_tags WHERE memo_id = ? AND user_id = ?").bind(id, user.id),
    c.env.DB.prepare("DELETE FROM memos WHERE id = ? AND user_id = ?").bind(id, user.id),
  ]);
  if (!res[1].meta.changes) return c.json({ error: "不存在" }, 404);
  return c.json({ ok: true });
});

memos.get("/tags", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT tag, COUNT(*) AS count FROM memo_tags WHERE user_id = ? GROUP BY tag ORDER BY tag",
  )
    .bind(c.get("user").id)
    .all<{ tag: string; count: number }>();
  return c.json({ tags: results });
});

/** 侧边栏统计 + 热力图。tz = 客户端 getTimezoneOffset()（分钟） */
memos.get("/stats", async (c) => {
  const userId = c.get("user").id;
  const offsetSec = -(Number(c.req.query("tz")) || 0) * 60;
  const since = Date.now() - 16 * 7 * 24 * 3600 * 1000;
  const [totals, days] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS memos,
              (SELECT COUNT(DISTINCT tag) FROM memo_tags WHERE user_id = ?1) AS tags,
              COUNT(DISTINCT date(created_at / 1000 + ?2, 'unixepoch')) AS days
         FROM memos WHERE user_id = ?1`,
    ).bind(userId, offsetSec),
    c.env.DB.prepare(
      `SELECT date(created_at / 1000 + ?2, 'unixepoch') AS day, COUNT(*) AS count
         FROM memos WHERE user_id = ?1 AND created_at >= ?3 GROUP BY day`,
    ).bind(userId, offsetSec, since),
  ]);
  return c.json({ totals: totals.results[0], heatmap: days.results });
});

/** 导出：format = md | json，可按 tag 过滤（包含子标签） */
memos.get("/export", async (c) => {
  const { tag, format = "md", q } = c.req.query();
  const f = buildFilter(c.get("user").id, q, tag);
  const { results } = await c.env.DB.prepare(`${SELECT_MEMO} WHERE ${f.sql} ORDER BY m.created_at ASC`)
    .bind(...f.params)
    .all<MemoRow>();
  const list = results.map(toMemo);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `memos${tag ? "-" + tag.replace(/[\/\\]/g, "_") : ""}-${stamp}`;

  if (format === "json") {
    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        filter: { tag: tag || null, q: q || null },
        count: list.length,
        memos: list.map((m) => ({
          ...m,
          createdAt: new Date(m.createdAt).toISOString(),
          updatedAt: new Date(m.updatedAt).toISOString(),
        })),
      },
      null,
      2,
    );
    return c.body(body, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base + ".json")}`,
    });
  }

  // Markdown：每条 memo 一个二级标题，带时间与标签元信息，便于 AI 分析
  const lines = [
    `# Memos 导出`,
    ``,
    `- 导出时间：${new Date().toISOString()}`,
    `- 筛选标签：${tag ? "#" + tag : "全部"}`,
    `- 条数：${list.length}`,
    ``,
  ];
  for (const m of list) {
    lines.push(`---`, ``, `## ${new Date(m.createdAt).toISOString()}`, ``);
    if (m.tags.length) lines.push(`tags: ${m.tags.map((t) => "#" + t).join(" ")}`, ``);
    lines.push(m.content, ``);
  }
  return c.body(lines.join("\n"), 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base + ".md")}`,
  });
});
