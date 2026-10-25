import { Hono } from "hono";
import { SCOPES, type AppEnv, type Scope } from "./env";
import { requireUser } from "./auth";
import { randomToken, sha256 } from "./lib/crypto";
import { createToken } from "./lib/pat";

const DEVICE_TTL_MS = 10 * 60_000;
const DEVICE_INTERVAL_S = 3;
const DEVICE_SCOPES: Scope[] = ["memos:read", "memos:write", "export", "insights:read"];

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  last_used_at: number | null;
  expires_at: number | null;
  created_at: number;
}

function toToken(r: TokenRow) {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes.split(" ").filter(Boolean),
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

function parseScopes(input: unknown): Scope[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const set = new Set<Scope>();
  for (const s of input) {
    if (!SCOPES.includes(s)) return null;
    set.add(s);
  }
  return [...set];
}

export const tokens = new Hono<AppEnv>();

// ---------- Token 管理（只允许网页登录会话操作） ----------

tokens.get("/tokens", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, prefix, scopes, last_used_at, expires_at, created_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.get("user").id)
    .all<TokenRow>();
  return c.json({ tokens: results.map(toToken) });
});

tokens.post("/tokens", requireUser, async (c) => {
  const body = await c.req.json<{ name?: string; scopes?: unknown; expiresInDays?: number | null }>();
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return c.json({ error: "请填写名称" }, 400);
  const scopes = parseScopes(body.scopes);
  if (!scopes) return c.json({ error: "权限不正确" }, 400);
  const days = Number(body.expiresInDays);
  const expiresAt = days > 0 ? Date.now() + days * 86400_000 : null;
  const t = await createToken(c.env.DB, c.get("user").id, name, scopes, expiresAt);
  return c.json(
    {
      token: t.secret,
      info: toToken({ id: t.id, name, prefix: t.secret.slice(0, 12), scopes: scopes.join(" "), last_used_at: null, expires_at: expiresAt, created_at: t.createdAt }),
    },
    201,
  );
});

tokens.delete("/tokens/:id", requireUser, async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  if (!res.meta.changes) return c.json({ error: "不存在" }, 404);
  return c.json({ ok: true });
});

// ---------- 设备码登录（CLI） ----------

/** 8 位用户码，形如 ABCD-EFGH；去掉易混淆的字符 */
function userCode() {
  const alphabet = "BCDFGHJKLMNPQRSTVWXZ";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** CLI 发起：返回 device_code（CLI 保存）和 user_code（用户在网页确认） */
tokens.post("/device/code", async (c) => {
  const body = await c.req.json<{ client_name?: string }>().catch(() => ({}) as { client_name?: string });
  const clientName = String(body.client_name ?? "CLI").trim().slice(0, 60) || "CLI";
  const deviceCode = randomToken(32);
  const code = userCode();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(now),
    c.env.DB.prepare(
      `INSERT INTO device_codes (device_code_hash, user_code, client_name, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(await sha256(deviceCode), code, clientName, DEVICE_SCOPES.join(" "), now + DEVICE_TTL_MS, now),
  ]);
  const origin = new URL(c.req.url).origin;
  return c.json({
    device_code: deviceCode,
    user_code: code,
    verification_uri: `${origin}/device`,
    verification_uri_complete: `${origin}/device?code=${code}`,
    expires_in: DEVICE_TTL_MS / 1000,
    interval: DEVICE_INTERVAL_S,
  });
});

/** CLI 轮询：批准后生成 Token 并删除设备码记录 */
tokens.post("/device/token", async (c) => {
  const body = await c.req.json<{ device_code?: string }>().catch(() => ({}) as { device_code?: string });
  const hash = await sha256(String(body.device_code ?? ""));
  const row = await c.env.DB.prepare(
    "SELECT client_name, scopes, status, user_id, expires_at FROM device_codes WHERE device_code_hash = ?",
  )
    .bind(hash)
    .first<{ client_name: string; scopes: string; status: string; user_id: string | null; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return c.json({ error: "expired_token" }, 400);
  if (row.status === "denied") {
    await c.env.DB.prepare("DELETE FROM device_codes WHERE device_code_hash = ?").bind(hash).run();
    return c.json({ error: "access_denied" }, 400);
  }
  if (row.status !== "approved" || !row.user_id) return c.json({ error: "authorization_pending" }, 400);
  // 先删再发，保证同一个设备码只换一次 Token
  const del = await c.env.DB.prepare("DELETE FROM device_codes WHERE device_code_hash = ?").bind(hash).run();
  if (!del.meta.changes) return c.json({ error: "expired_token" }, 400);
  const t = await createToken(c.env.DB, row.user_id, row.client_name, row.scopes.split(" ") as Scope[], null);
  return c.json({ access_token: t.secret, token_type: "bearer", scopes: row.scopes.split(" ") });
});

/** 网页端：查看待确认的设备 */
tokens.get("/device/:code", requireUser, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT client_name, scopes, status, expires_at FROM device_codes WHERE user_code = ?",
  )
    .bind(c.req.param("code").toUpperCase())
    .first<{ client_name: string; scopes: string; status: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return c.json({ error: "代码无效或已过期" }, 404);
  return c.json({ clientName: row.client_name, scopes: row.scopes.split(" "), status: row.status });
});

/** 网页端：批准或拒绝 */
tokens.post("/device/:code", requireUser, async (c) => {
  const { approve } = await c.req.json<{ approve?: boolean }>();
  const res = await c.env.DB.prepare(
    `UPDATE device_codes SET status = ?, user_id = ?
      WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(approve ? "approved" : "denied", c.get("user").id, c.req.param("code").toUpperCase(), Date.now())
    .run();
  if (!res.meta.changes) return c.json({ error: "代码无效或已过期" }, 404);
  return c.json({ ok: true });
});
