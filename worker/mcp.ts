// MCP 服务器：/mcp（Streamable HTTP，无状态）。鉴权用 API Token（Authorization: Bearer）。
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import type { Env, Scope, User } from "./env";
import { findToken } from "./lib/pat";
import { createMemo, getMemo, listMemos, listTags, MemoError, type Memo } from "./memo-service";

function formatMemo(m: Memo) {
  const time = new Date(m.createdAt).toISOString();
  return `[${m.id}] ${time}${m.tags.length ? " " + m.tags.map((t) => "#" + t).join(" ") : ""}\n${m.content}`;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

function createServer(env: Env, user: User, scopes: Scope[]) {
  const server = new McpServer({ name: "yaf", version: "2.0.0" });
  const can = (s: Scope) => scopes.includes(s);
  const denied = (s: Scope) => fail(`当前 Token 没有 ${s} 权限`);

  server.registerTool(
    "search_memos",
    {
      title: "搜索 memo",
      description:
        "在用户的 yaf 笔记（memo）里按关键词和 / 或标签搜索，按时间倒序返回。query 用空格分隔多个词，需全部命中；tag 不带 #，包含子标签。都不传时返回最新的 memo。",
      inputSchema: z.object({
        query: z.string().optional().describe("关键词，空格分隔"),
        tag: z.string().optional().describe("标签，如 读书 或 project/yaf"),
        limit: z.number().int().min(1).max(50).optional().describe("返回条数，默认 20"),
      }),
    },
    async ({ query, tag, limit }) => {
      if (!can("memos:read")) return denied("memos:read");
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
        return text(`已记录 ${m.id}${m.tags.length ? " · " + m.tags.map((t) => "#" + t).join(" ") : ""}`);
      } catch (e) {
        if (e instanceof MemoError) return fail(e.message);
        throw e;
      }
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
    return createMcpHandler(() => createServer(env, found.user, found.scopes), { route: "/mcp" })(request, env, ctx);
  }
  return createMcpHandler(() => new McpServer({ name: "yaf", version: "2.0.0" }), { route: "/mcp" })(request, env, ctx);
}
