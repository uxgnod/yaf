import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { requireScope, requireUser } from "../auth";
import { seal } from "../lib/secret-box";
import { cleanTags } from "../auto-tags";
import { DEFAULT_RULES, notifyStop, type WechatRules } from "./bridge";
import { getQrCode, getQrStatus, notify } from "./protocol";

// 二维码有效期（协议侧约 5 分钟）；过期后前端点「刷新」重新获取
const QR_TTL_MS = 5 * 60_000;
// 单次查询扫码状态的长轮询时间：Worker 请求不宜过长
const STATUS_POLL_MS = 20_000;

interface Row {
  user_id: string;
  status: string;
  bot_token_enc: string | null;
  bot_id: string | null;
  wechat_user_id: string | null;
  base_url: string | null;
  rules: string;
  login_qrcode: string | null;
  login_host: string | null;
  login_verify_code: string | null;
  login_started_at: number | null;
  last_event_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

const bridge = (env: Env, userId: string) => env.WECHAT.get(env.WECHAT.idFromName(userId));

function view(r: Row | null) {
  if (!r) return { status: "none" as const, rules: DEFAULT_RULES };
  return {
    status: r.status,
    botId: r.bot_id ? r.bot_id.slice(0, 6) + "…" : null,
    rules: { ...DEFAULT_RULES, ...JSON.parse(r.rules || "{}") } as WechatRules,
    lastEventAt: r.last_event_at,
    lastError: r.last_error,
    connectedAt: r.status === "active" || r.status === "error" ? r.updated_at : null,
    qrExpiresAt: r.status === "pending" && r.login_started_at ? r.login_started_at + QR_TTL_MS : null,
  };
}

async function load(env: Env, userId: string) {
  return env.DB.prepare("SELECT * FROM wechat_bindings WHERE user_id = ?").bind(userId).first<Row>();
}

export const wechat = new Hono<AppEnv>();

wechat.get("/wechat", requireUser, async (c) => {
  const r = await load(c.env, c.get("user").id);
  const v = view(r);
  return c.json({ ...v, mediaEnabled: Boolean(c.env.MEDIA) });
});

/** 获取二维码。已连接时需先解绑 */
wechat.post("/wechat/qrcode", requireUser, async (c) => {
  const userId = c.get("user").id;
  const existing = await load(c.env, userId);
  if (existing?.status === "active") return c.json({ error: "已经连接微信，如需更换请先解绑" }, 409);
  let qr;
  try {
    qr = await getQrCode();
  } catch (e) {
    return c.json({ error: `获取二维码失败：${e instanceof Error ? e.message : e}` }, 502);
  }
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO wechat_bindings (user_id, status, rules, login_qrcode, login_host, login_verify_code, login_started_at, created_at, updated_at)
     VALUES (?, 'pending', ?, ?, NULL, NULL, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET status = 'pending', login_qrcode = excluded.login_qrcode, login_host = NULL,
       login_verify_code = NULL, login_started_at = excluded.login_started_at, last_error = NULL, updated_at = excluded.updated_at`,
  )
    .bind(userId, JSON.stringify(DEFAULT_RULES), qr.qrcode, now, now, now)
    .run();
  // qrcode_img_content 是要编码进二维码的内容，由前端渲染成图片
  return c.json({ qrContent: qr.qrcode_img_content, expiresAt: now + QR_TTL_MS });
});

/**
 * 查询扫码状态（长轮询最多约 20 秒）。前端循环调用。
 * 返回 status：wait | scaned | need_verifycode | verify_code_blocked | expired | confirmed | already_bound | error
 */
wechat.get("/wechat/qrcode/status", requireUser, async (c) => {
  const userId = c.get("user").id;
  const r = await load(c.env, userId);
  if (!r || r.status !== "pending" || !r.login_qrcode) return c.json({ status: r?.status === "active" ? "confirmed" : "none" });
  if (r.login_started_at && Date.now() - r.login_started_at > QR_TTL_MS) return c.json({ status: "expired" });

  let s;
  try {
    s = await getQrStatus(r.login_host, r.login_qrcode, r.login_verify_code, STATUS_POLL_MS);
  } catch (e) {
    return c.json({ status: "wait", warning: e instanceof Error ? e.message : String(e) });
  }

  switch (s.status) {
    case "scaned_but_redirect":
      // 换到新的机房域名继续轮询
      if (s.redirect_host) {
        await c.env.DB.prepare("UPDATE wechat_bindings SET login_host = ? WHERE user_id = ?").bind(s.redirect_host, userId).run();
      }
      return c.json({ status: "scaned" });
    case "scaned":
      if (r.login_verify_code) {
        await c.env.DB.prepare("UPDATE wechat_bindings SET login_verify_code = NULL WHERE user_id = ?").bind(userId).run();
      }
      return c.json({ status: "scaned" });
    case "need_verifycode":
      return c.json({ status: "need_verifycode", retry: Boolean(r.login_verify_code) });
    case "binded_redirect":
      return c.json({ status: "already_bound" });
    case "confirmed": {
      if (!s.bot_token || !s.ilink_bot_id) return c.json({ status: "error", error: "微信没有返回 bot_token" });
      const baseUrl = s.baseurl || (r.login_host ? `https://${r.login_host}` : "https://ilinkai.weixin.qq.com");
      await c.env.DB.prepare(
        `UPDATE wechat_bindings SET status = 'active', bot_token_enc = ?, bot_id = ?, wechat_user_id = ?, base_url = ?,
           login_qrcode = NULL, login_host = NULL, login_verify_code = NULL, last_error = NULL, updated_at = ?
         WHERE user_id = ?`,
      )
        .bind(await seal(c.env.ENCRYPTION_KEY, s.bot_token), s.ilink_bot_id, s.ilink_user_id ?? null, baseUrl, Date.now(), userId)
        .run();
      await notify(baseUrl, s.bot_token, "notifystart");
      await bridge(c.env, userId).start(userId);
      return c.json({ status: "confirmed" });
    }
    default:
      return c.json({ status: s.status });
  }
});

/** 提交手机上显示的验证码，下一次查询状态时带上 */
wechat.post("/wechat/qrcode/verify", requireUser, async (c) => {
  const { code } = await c.req.json<{ code?: string }>();
  const v = String(code ?? "").trim();
  if (!/^\d{4,8}$/.test(v)) return c.json({ error: "请输入手机微信上显示的数字" }, 400);
  await c.env.DB.prepare("UPDATE wechat_bindings SET login_verify_code = ? WHERE user_id = ? AND status = 'pending'")
    .bind(v, c.get("user").id)
    .run();
  return c.json({ ok: true });
});

wechat.patch("/wechat/rules", requireUser, async (c) => {
  const body = await c.req.json<Partial<WechatRules>>();
  const userId = c.get("user").id;
  const r = await load(c.env, userId);
  if (!r) return c.json({ error: "还没有连接微信" }, 404);
  const rules: WechatRules = { ...DEFAULT_RULES, ...JSON.parse(r.rules || "{}") };
  for (const k of ["autoTag", "keepAudio", "replyConfirm", "mergeWindow"] as const) {
    if (typeof body[k] === "boolean") rules[k] = body[k];
  }
  if (body.autoTags !== undefined) {
    const tags = cleanTags(body.autoTags);
    if (!tags.length) return c.json({ error: "至少保留一个标签" }, 400);
    rules.autoTags = tags;
  }
  await c.env.DB.prepare("UPDATE wechat_bindings SET rules = ? WHERE user_id = ?").bind(JSON.stringify(rules), userId).run();
  return c.json({ rules });
});

/** 解绑：停止轮询、通知微信、删除 token */
wechat.delete("/wechat", requireUser, async (c) => {
  const userId = c.get("user").id;
  const r = await load(c.env, userId);
  if (!r) return c.json({ ok: true });
  await bridge(c.env, userId).stop();
  c.executionCtx.waitUntil(notifyStop(c.env, r));
  await c.env.DB.prepare(
    `UPDATE wechat_bindings SET status = 'unbound', bot_token_enc = NULL, bot_id = NULL, wechat_user_id = NULL, base_url = NULL,
       login_qrcode = NULL, last_error = NULL, updated_at = ? WHERE user_id = ?`,
  )
    .bind(Date.now(), userId)
    .run();
  return c.json({ ok: true });
});

/** 附件文件：校验归属后从 R2 读取 */
wechat.get("/attachments/:id", requireScope("memos:read"), async (c) => {
  const att = await c.env.DB.prepare("SELECT r2_key, playback_key, mime FROM attachments WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .first<{ r2_key: string | null; playback_key: string | null; mime: string | null }>();
  const key = c.req.query("playback") ? att?.playback_key : att?.r2_key;
  if (!att || !key || !c.env.MEDIA) return c.json({ error: "不存在" }, 404);
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: "不存在" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? att.mime ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
