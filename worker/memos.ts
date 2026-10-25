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
import { indexStatus, related, scheduleIndex, scheduleRemove, search, startIndexJob, type SearchMode } from "./search";

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

const MODES: SearchMode[] = ["hybrid", "keyword", "semantic"];

memos.get("/memos", requireScope("memos:read"), async (c) => {
  const { q, tag, cursor, mode, sort } = c.req.query();
  // 有搜索词时走混合检索（mode 默认 hybrid）；legacy 模式保留原来的子串匹配 + 时间分页
  if (q?.trim() && mode !== "legacy") {
    return c.json(
      await search(c.env, c.get("user").id, {
        q,
        tag,
        mode: MODES.includes(mode as SearchMode) ? (mode as SearchMode) : "hybrid",
        sort: sort === "time" ? "time" : "relevance",
        limit: Number(c.req.query("limit")) || 50,
      }),
    );
  }
  return c.json(await listMemos(c.env.DB, c.get("user").id, { q, tag, cursor, limit: Number(c.req.query("limit")) }));
});

memos.get("/memos/:id", requireScope("memos:read"), async (c) => {
  const memo = await getMemo(c.env.DB, c.get("user").id, c.req.param("id"));
  if (!memo) return c.json({ error: "不存在" }, 404);
  return c.json({ memo });
});

memos.get("/memos/:id/related", requireScope("memos:read"), async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 3, 10);
  return c.json({ memos: await related(c.env, c.get("user").id, c.req.param("id"), limit) });
});

memos.post("/memos", requireScope("memos:write"), async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  const user = c.get("user");
  const memo = await createMemo(c.env.DB, user.id, content, sourceOf(c));
  scheduleIndex(c.env, c.executionCtx, user.id, memo);
  return c.json({ memo }, 201);
});

memos.patch("/memos/:id", requireScope("memos:write"), async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  const user = c.get("user");
  const memo = await updateMemo(c.env.DB, user.id, c.req.param("id"), content);
  scheduleIndex(c.env, c.executionCtx, user.id, memo);
  return c.json({ memo });
});

memos.delete("/memos/:id", requireScope("memos:write"), async (c) => {
  const files = await deleteMemo(c.env.DB, c.get("user").id, c.req.param("id"));
  scheduleRemove(c.env, c.executionCtx, c.req.param("id"));
  if (files.length && c.env.MEDIA) c.executionCtx.waitUntil(c.env.MEDIA.delete(files));
  return c.json({ ok: true });
});

/** 语义索引状态：已索引 / 总数、补算任务是否在跑 */
memos.get("/search/status", requireScope("memos:read"), async (c) => c.json(await indexStatus(c.env, c.get("user").id)));

/** 补算缺失的向量；full = true 时重建全部 */
memos.post("/search/reindex", requireScope("memos:write"), async (c) => {
  const { full } = await c.req.json<{ full?: boolean }>().catch(() => ({ full: false }));
  return c.json(await startIndexJob(c.env, c.get("user").id, Boolean(full)));
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
