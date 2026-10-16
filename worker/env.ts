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

export type AppEnv = { Bindings: Env; Variables: { user: User } };
