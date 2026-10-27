export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  VECTORS: Vectorize;
  INDEX_WORKFLOW: Workflow<{ userId: string }>;
  INSIGHT_WORKFLOW: Workflow<import("./insight-workflow").InsightParams>;
  WECHAT: DurableObjectNamespace<import("./wechat/bridge").WechatBridge>;
  /** 微信图片 / 语音原文件；R2 未开通时不绑定，附件只记录描述 */
  MEDIA?: R2Bucket;
  /** AI Gateway id；留空则不经过 Gateway */
  AI_GATEWAY_ID?: string;
  /** 32 字节 base64，用于加密用户的 Claude API key（`wrangler secret put ENCRYPTION_KEY`） */
  ENCRYPTION_KEY?: string;
  /** 若设置（`wrangler secret put SETUP_TOKEN`），首次创建 admin 时需提供该口令，防止部署后被他人抢先注册 */
  SETUP_TOKEN?: string;
  /** 账户 ID，查 AI 用量用（`wrangler secret put CF_ACCOUNT_ID`，不写进 wrangler.jsonc） */
  CF_ACCOUNT_ID?: string;
  /** 只有「Account Analytics: Read」权限的 API Token（`wrangler secret put CF_ANALYTICS_TOKEN`）；不设置则不显示 AI 用量 */
  CF_ANALYTICS_TOKEN?: string;
  /** Workers 套餐：free | paid，只影响用量卡片上的文字（`wrangler secret put AI_PLAN`，不设置按 free） */
  AI_PLAN?: string;
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
