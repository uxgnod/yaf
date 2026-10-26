import { Hono, type Context } from "hono";
import type { AppEnv, Source } from "./env";
import { requireScope, requireUser } from "./auth";
import {
  buildFilter,
  createMemo,
  deleteMemo,
  getMemo,
  lensCounts,
  listMemos,
  listTags,
  MemoError,
  SELECT_MEMO,
  toMemo,
  updateMemo,
  type MemoRow,
  type Visibility,
} from "./memo-service";
import { applyPrivate, maskPrivate } from "./judge";
import { LENS_REV, lensByKey } from "./lenses";
import { withChannelTags } from "./auto-tags";
import { indexMemos, indexStatus, related, scheduleIndex, scheduleRemove, search, startIndexJob, type SearchMode } from "./search";

/** 网页会话记为 web；Token 调用可用 X-Yaf-Source 标明 cli，否则记为 api */
function sourceOf(c: Context<AppEnv>): Source {
  if (c.get("auth").kind === "session") return "web";
  return c.req.header("X-Yaf-Source") === "cli" ? "cli" : "api";
}

/** 网页会话能看到全部（隐私 memo 返回遮挡文本）；Token 看不到隐私和还没判定的 memo */
const visibilityOf = (c: Context<AppEnv>): Visibility => (c.get("auth").kind === "session" ? "owner" : "token");

export const memos = new Hono<AppEnv>();

memos.onError((err, c) => {
  if (err instanceof MemoError) return c.json({ error: err.message }, err.status);
  throw err;
});

const MODES: SearchMode[] = ["hybrid", "keyword", "semantic"];

memos.get("/memos", requireScope("memos:read"), async (c) => {
  const { q, tag, cursor, mode, sort, lens } = c.req.query();
  const visibility = visibilityOf(c);
  // 有搜索词时走混合检索（mode 默认 hybrid）；legacy 模式保留原来的子串匹配 + 时间分页
  if (q?.trim() && mode !== "legacy") {
    return c.json(
      await search(c.env, c.get("user").id, {
        q,
        tag,
        mode: MODES.includes(mode as SearchMode) ? (mode as SearchMode) : "hybrid",
        sort: sort === "time" ? "time" : "relevance",
        limit: Number(c.req.query("limit")) || 50,
        visibility,
      }),
    );
  }
  return c.json(
    await listMemos(c.env.DB, c.get("user").id, { q, tag, lens, cursor, visibility, limit: Number(c.req.query("limit")) }),
  );
});

memos.get("/memos/:id", requireScope("memos:read"), async (c) => {
  const memo = await getMemo(c.env.DB, c.get("user").id, c.req.param("id"), { visibility: visibilityOf(c) });
  if (!memo) return c.json({ error: "不存在" }, 404);
  return c.json({ memo });
});

/** 隐私 memo 的原文：只给网页会话（显示原文、编辑时用） */
memos.get("/memos/:id/raw", requireUser, async (c) => {
  const memo = await getMemo(c.env.DB, c.get("user").id, c.req.param("id"), { raw: true });
  if (!memo) return c.json({ error: "不存在" }, 404);
  return c.json({ content: memo.content });
});

/** 用户手动改视图标记（记为 user，模型重判时不覆盖） */
memos.put("/memos/:id/labels/:label", requireUser, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const lens = lensByKey(c.req.param("label"));
  if (!lens) return c.json({ error: "没有这个视图" }, 400);
  const { value } = await c.req.json<{ value?: boolean }>();
  const row = await c.env.DB.prepare("SELECT content, created_at FROM memos WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first<{ content: string; created_at: number }>();
  if (!row) return c.json({ error: "不存在" }, 404);
  await c.env.DB.prepare(
    `INSERT INTO memo_labels (memo_id, user_id, label, score, source, rev, updated_at) VALUES (?, ?, ?, ?, 'user', ?, ?)
     ON CONFLICT(memo_id, label) DO UPDATE SET score = excluded.score, source = 'user', rev = excluded.rev, updated_at = excluded.updated_at`,
  )
    .bind(id, user.id, lens.key, value ? 1 : 0, LENS_REV, Date.now())
    .run();
  if (lens.key === "private") {
    if (value) {
      const masked = await maskPrivate(c.env, row.content);
      await c.env.DB.prepare("UPDATE memos SET is_private = 1, masked_content = ? WHERE id = ?").bind(masked, id).run();
      await applyPrivate(c.env, id, user.id, masked);
    } else {
      await c.env.DB.prepare("UPDATE memos SET is_private = 0, masked_content = NULL, vector_hash = NULL WHERE id = ?").bind(id).run();
      // 重新写入原文的全文索引和向量
      c.executionCtx.waitUntil(
        indexMemos(c.env, [{ id, user_id: user.id, content: row.content, created_at: row.created_at }]).catch((e) =>
          console.error("index failed", id, e),
        ),
      );
    }
  }
  return c.json({ memo: await getMemo(c.env.DB, user.id, id) });
});

/** 各视图的条数 */
memos.get("/lenses", requireScope("memos:read"), async (c) => c.json({ lenses: await lensCounts(c.env.DB, c.get("user").id) }));

memos.get("/memos/:id/related", requireScope("memos:read"), async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 3, 10);
  return c.json({ memos: await related(c.env, c.get("user").id, c.req.param("id"), limit, visibilityOf(c)) });
});

memos.post("/memos", requireScope("memos:write"), async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  const user = c.get("user");
  const source = sourceOf(c);
  const memo = await createMemo(c.env.DB, user.id, await withChannelTags(c.env.DB, user.id, source, content ?? ""), source);
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
  // 隐私 memo 默认导出遮挡文本；只有网页会话可以选择导出原文
  const raw = c.req.query("private") === "raw" && c.get("auth").kind === "session";
  const f = buildFilter(c.get("user").id, q, tag, { visibility: visibilityOf(c) });
  const { results } = await c.env.DB.prepare(`${SELECT_MEMO} WHERE ${f.sql} ORDER BY m.created_at ASC`)
    .bind(...f.params)
    .all<MemoRow>();
  const list = results.map((r) => {
    const { private: _p, judged: _j, lenses: _l, ask: _a, ...m } = toMemo(r, { raw });
    return m;
  });
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
