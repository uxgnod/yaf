import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv, User } from "./env";

const SESSION_COOKIE = "yaf_sid";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
// Workers 的 WebCrypto 对 PBKDF2 迭代次数上限为 100000
const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(s: string): Promise<string> {
  return toB64(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** 格式：pbkdf2$<iterations>$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2" || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromB64(salt), Number(iter));
  const expected = fromB64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function validateCredentials(email: unknown, password: unknown): string | null {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "邮箱格式不正确";
  if (typeof password !== "string" || password.length < 8) return "密码至少 8 位";
  return null;
}

async function createSession(c: Context<AppEnv>, userId: string) {
  const sid = randomToken();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(sid), userId, now + SESSION_TTL_MS, now)
    .run();
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: "未登录" }, 401);
  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(sid), Date.now())
    .first<User>();
  if (!user) return c.json({ error: "未登录" }, 401);
  c.set("user", user);
  await next();
});

export const auth = new Hono<AppEnv>();

/** 前端启动时调用：是否需要初始化 admin */
auth.get("/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({ needsSetup: (row?.n ?? 0) === 0, setupTokenRequired: Boolean(c.env.SETUP_TOKEN) });
});

/** 首次启动：创建 admin。仅在没有任何用户时可用 */
auth.post("/setup", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; name?: string; setupToken?: string }>();
  if (c.env.SETUP_TOKEN && body.setupToken !== c.env.SETUP_TOKEN) return c.json({ error: "初始化口令错误" }, 403);
  const err = validateCredentials(body.email, body.password);
  if (err) return c.json({ error: err }, 400);

  const id = crypto.randomUUID();
  const email = body.email!.trim().toLowerCase();
  // 用 WHERE NOT EXISTS 保证并发下也只会创建一个 admin
  const res = await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at)
     SELECT ?, ?, ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, email, body.name?.trim() || null, await hashPassword(body.password!), Date.now())
    .run();
  if (!res.meta.changes) return c.json({ error: "已初始化，请直接登录" }, 409);

  await createSession(c, id);
  return c.json({ ok: true });
});

auth.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = String(body.email ?? "").trim().toLowerCase();
  const row = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_hash))) {
    return c.json({ error: "邮箱或密码错误" }, 401);
  }
  await createSession(c, row.id);
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(sid)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

auth.get("/me", requireUser, (c) => c.json({ user: c.get("user") }));
