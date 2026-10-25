import type { Scope, User } from "../env";
import { randomToken, sha256 } from "./crypto";

const TOKEN_PREFIX = "yaf_pat_";
// last_used_at 最多每分钟写一次，避免每次请求都写库
const TOUCH_INTERVAL_MS = 60_000;

/** 校验明文 Token，返回所属用户和权限；顺便（节流）更新 last_used_at */
export async function findToken(db: D1Database, token: string, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await db
    .prepare(
      `SELECT t.id AS token_id, t.scopes, t.expires_at, t.last_used_at,
              u.id, u.email, u.name, u.role, u.created_at
         FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?`,
    )
    .bind(await sha256(token))
    .first<User & { token_id: string; scopes: string; expires_at: number | null; last_used_at: number | null }>();
  const now = Date.now();
  if (!row || (row.expires_at && row.expires_at <= now)) return null;
  if (!row.last_used_at || now - row.last_used_at > TOUCH_INTERVAL_MS) {
    const p = db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(now, row.token_id).run();
    if (ctx) ctx.waitUntil(p);
    else await p;
  }
  return {
    tokenId: row.token_id,
    scopes: row.scopes.split(" ").filter(Boolean) as Scope[],
    user: { id: row.id, email: row.email, name: row.name, role: row.role, created_at: row.created_at },
  };
}

/** 生成新 Token，返回明文（只此一次） */
export async function createToken(db: D1Database, userId: string, name: string, scopes: Scope[], expiresAt: number | null) {
  const secret = TOKEN_PREFIX + randomToken(24);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, name, secret.slice(0, TOKEN_PREFIX.length + 4), await sha256(secret), scopes.join(" "), expiresAt, now)
    .run();
  return { id, secret, createdAt: now };
}
