export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 若设置（`wrangler secret put SETUP_TOKEN`），首次创建 admin 时需提供该口令，防止部署后被他人抢先注册 */
  SETUP_TOKEN?: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  created_at: number;
}

export const SCOPES = ["memos:read", "memos:write", "export", "insights:read"] as const;
export type Scope = (typeof SCOPES)[number];

/** memo 来源；web 为默认值，界面上不显示 */
export const SOURCES = ["web", "wechat", "api", "mcp", "cli"] as const;
export type Source = (typeof SOURCES)[number];

/** 当前请求的身份：登录会话拥有全部权限；Token 只拥有其 scopes */
export type Auth = { kind: "session" } | { kind: "token"; tokenId: string; scopes: Scope[] };

export type AppEnv = { Bindings: Env; Variables: { user: User; auth: Auth } };
