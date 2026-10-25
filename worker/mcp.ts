// MCP 服务器：/mcp（Streamable HTTP，无状态）。鉴权用 API Token（Authorization: Bearer）。
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import type { Env, Scope, User } from "./env";
import { findToken } from "./lib/pat";
import { createMemo, getMemo, listMemos, listTags, MemoError, type Memo } from "./memo-service";
import { related, scheduleIndex, search } from "./search";
import { getInsight, listInsights } from "./insights";

function formatMemo(m: Memo) {
  const time = new Date(m.createdAt).toISOString();
  return `[${m.id}] ${time}${m.tags.length ? " " + m.tags.map((t) => "#" + t).join(" ") : ""}\n${m.content}`;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

function createServer(env: Env, ctx: ExecutionContext, user: User, scopes: Scope[]) {
  const server = new McpServer({ name: "yaf", version: "2.0.0" });
  const can = (s: Scope) => scopes.includes(s);
  const denied = (s: Scope) => fail(`当前 Token 没有 ${s} 权限`);

  server.registerTool(
    "search_memos",
    {
      title: "搜索 memo",
      description:
        "在用户的 yaf 笔记（memo）里搜索。传 query 时默认混合检索（关键词 + 语义，按相关度排序），能找到意思相近但用词不同的 memo；tag 不带 #，包含子标签。都不传时按时间倒序返回最新的 memo。",
      inputSchema: z.object({
        query: z.string().optional().describe("搜索内容，可以是关键词，也可以是一句话"),
        mode: z.enum(["hybrid", "keyword", "semantic"]).optional().describe("检索方式，默认 hybrid"),
        tag: z.string().optional().describe("标签，如 读书 或 project/yaf"),
        limit: z.number().int().min(1).max(50).optional().describe("返回条数，默认 20"),
      }),
    },
    async ({ query, mode, tag, limit }) => {
      if (!can("memos:read")) return denied("memos:read");
      if (query?.trim()) {
        const r = await search(env, user.id, { q: query, tag, mode, limit: limit ?? 20 });
        if (!r.memos.length) return text("没有找到匹配的 memo。");
        return text(
          `找到 ${r.memos.length} 条（关键词 ${r.stats.keyword} · 语义 ${r.stats.semantic}）：\n\n` +
            r.memos.map(formatMemo).join("\n\n---\n\n"),
        );
      }
      const r = await listMemos(env.DB, user.id, { q: query, tag, limit: limit ?? 20 });
      if (!r.memos.length) return text("没有找到匹配的 memo。");
      return text(`找到 ${r.memos.length} 条${r.nextCursor ? "（还有更多）" : ""}：\n\n` + r.memos.map(formatMemo).join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "get_memo",
    {
      title: "读取 memo",
      description: "按 id 读取一条 memo 的完整内容。",
      inputSchema: z.object({ id: z.string().describe("memo id") }),
    },
    async ({ id }) => {
      if (!can("memos:read")) return denied("memos:read");
      const m = await getMemo(env.DB, user.id, id);
      return m ? text(formatMemo(m)) : fail("memo 不存在");
    },
  );

  server.registerTool(
    "add_memo",
    {
      title: "新增 memo",
      description: "新增一条 memo。支持 Markdown；内容里的 #标签 会被自动识别，支持层级 #a/b。",
      inputSchema: z.object({ content: z.string().min(1).describe("memo 内容（Markdown）") }),
    },
    async ({ content }) => {
      if (!can("memos:write")) return denied("memos:write");
      try {
        const m = await createMemo(env.DB, user.id, content, "mcp");
        scheduleIndex(env, ctx, user.id, m);
        return text(`已记录 ${m.id}${m.tags.length ? " · " + m.tags.map((t) => "#" + t).join(" ") : ""}`);
      } catch (e) {
        if (e instanceof MemoError) return fail(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "get_related",
    {
      title: "相关笔记",
      description: "找出和某条 memo 语义上最相关的其他 memo（基于向量相似度）。",
      inputSchema: z.object({
        id: z.string().describe("memo id"),
        limit: z.number().int().min(1).max(10).optional().describe("返回条数，默认 5"),
      }),
    },
    async ({ id, limit }) => {
      if (!can("memos:read")) return denied("memos:read");
      const list = await related(env, user.id, id, limit ?? 5);
      if (!list.length) return text("没有找到相关的 memo（可能还没有建立语义索引）。");
      return text(list.map((m) => `相似度 ${m.score}\n${formatMemo(m)}`).join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "list_insights",
    {
      title: "洞察报告",
      description:
        "列出 yaf 按计划生成的洞察报告（反复出现的主题、新的连接、想做未做、值得追问的问题）。传 id 时返回该报告全文，否则返回最近的报告列表和最新一份的全文。",
      inputSchema: z.object({
        id: z.string().optional().describe("报告 id"),
        limit: z.number().int().min(1).max(20).optional().describe("列表条数，默认 5"),
      }),
    },
    async ({ id, limit }) => {
      if (!can("insights:read")) return denied("insights:read");
      const { insights: list } = await listInsights(env.DB, user.id, limit ?? 5);
      const targetId = id ?? list.find((i) => i.status === "ready")?.id;
      const head = list
        .map((i) => `- [${i.id}] ${new Date(i.createdAt).toISOString().slice(0, 10)} ${i.title ?? i.planName ?? ""}（${i.status}）`)
        .join("\n");
      if (!targetId) return text(list.length ? `最近的报告：\n${head}` : "还没有洞察报告。");
      const ins = await getInsight(env.DB, user.id, targetId);
      if (!ins?.content) return text(`最近的报告：\n${head}\n\n报告 ${targetId} 还没有生成完成。`);
      const c = ins.content;
      const cite = (ids: string[]) => ids.join(", ");
      const section = (name: string, items: { title: string; detail: string; memoIds: string[] }[]) =>
        items.length ? `\n## ${name}\n` + items.map((it) => `- ${it.title}：${it.detail}（memo ${cite(it.memoIds)}）`).join("\n") : "";
      return text(
        (id ? "" : `最近的报告：\n${head}\n\n---\n\n`) +
          `# ${ins.title}\n${c.summary}` +
          section("反复出现的主题", c.themes) +
          section("新的连接", c.connections) +
          section("想做未做", c.unfinished) +
          (c.questions.length ? `\n## 值得追问的问题\n` + c.questions.map((q) => `- ${q.question}（memo ${cite(q.memoIds)}）`).join("\n") : "") +
          `\n\n引用的 memo 可以用 get_memo 读取。`,
      );
    },
  );

  server.registerTool(
    "list_tags",
    {
      title: "列出标签",
      description: "列出全部标签及每个标签下的 memo 数量。",
      inputSchema: z.object({}),
    },
    async () => {
      if (!can("memos:read")) return denied("memos:read");
      const tags = await listTags(env.DB, user.id);
      return text(tags.length ? tags.map((t) => `#${t.tag} (${t.count})`).join("\n") : "还没有标签。");
    },
  );

  return server;
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // CORS 预检不带鉴权，交给 handler 处理
  if (request.method !== "OPTIONS") {
    const header = request.headers.get("Authorization") ?? "";
    const found = header.startsWith("Bearer ") ? await findToken(env.DB, header.slice(7).trim(), ctx) : null;
    if (!found) {
      return Response.json(
        { error: "需要 API Token：在 yaf 设置 › API Token 里新建，然后用 Authorization: Bearer <token> 调用" },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="yaf"' } },
      );
    }
    return createMcpHandler(() => createServer(env, ctx, found.user, found.scopes), { route: "/mcp" })(request, env, ctx);
  }
  return createMcpHandler(() => new McpServer({ name: "yaf", version: "2.0.0" }), { route: "/mcp" })(request, env, ctx);
}
