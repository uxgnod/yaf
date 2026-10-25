import { Hono, type Context } from "hono";
import type { AppEnv, Source } from "./env";
import { requireScope } from "./auth";
import {
  buildFilter,
  createMemo,
  deleteMemo,
  getMemo,
  listMemos,
  listTags,
  MemoError,
  SELECT_MEMO,
  toMemo,
  updateMemo,
  type MemoRow,
} from "./memo-service";

/** 网页会话记为 web；Token 调用可用 X-Yaf-Source 标明 cli，否则记为 api */
function sourceOf(c: Context<AppEnv>): Source {
  if (c.get("auth").kind === "session") return "web";
  return c.req.header("X-Yaf-Source") === "cli" ? "cli" : "api";
}

export const memos = new Hono<AppEnv>();

memos.onError((err, c) => {
  if (err instanceof MemoError) return c.json({ error: err.message }, err.status);
  throw err;
});

memos.get("/memos", requireScope("memos:read"), async (c) => {
  const { q, tag, cursor } = c.req.query();
  return c.json(await listMemos(c.env.DB, c.get("user").id, { q, tag, cursor, limit: Number(c.req.query("limit")) }));
});

memos.get("/memos/:id", requireScope("memos:read"), async (c) => {
  const memo = await getMemo(c.env.DB, c.get("user").id, c.req.param("id"));
  if (!memo) return c.json({ error: "不存在" }, 404);
  return c.json({ memo });
});

memos.post("/memos", requireScope("memos:write"), async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  return c.json({ memo: await createMemo(c.env.DB, c.get("user").id, content, sourceOf(c)) }, 201);
});

memos.patch("/memos/:id", requireScope("memos:write"), async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  return c.json({ memo: await updateMemo(c.env.DB, c.get("user").id, c.req.param("id"), content) });
});

memos.delete("/memos/:id", requireScope("memos:write"), async (c) => {
  await deleteMemo(c.env.DB, c.get("user").id, c.req.param("id"));
  return c.json({ ok: true });
});

memos.get("/tags", requireScope("memos:read"), async (c) => c.json({ tags: await listTags(c.env.DB, c.get("user").id) }));

memos.get("/stats", requireScope("memos:read"), async (c) => {
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
memos.get("/export", requireScope("export"), async (c) => {
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
