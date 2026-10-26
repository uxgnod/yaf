// 微信 ClawBot（iLink）协议适配层。只包含 yaf 用到的接口。
// 协议来自 @tencent-weixin/openclaw-weixin v2.4.10（MIT，版权声明见 THIRD_PARTY_NOTICES.md）源码；非官方接入，随时可能失效，
// 所以所有调用都集中在这里，失败只影响微信功能。

export const ILINK_BASE = "https://ilinkai.weixin.qq.com";
export const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
const APP_ID = "bot";
const CHANNEL_VERSION = "2.4.10";
const BOT_TYPE = "3";
// uint32：major<<16 | minor<<8 | patch
const CLIENT_VERSION = String((2 << 16) | (4 << 8) | 10);
const BOT_AGENT = "yaf/2.0";
/** bot_token 失效 */
export const STALE_TOKEN = -14;

export const ItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;
export const MessageType = { USER: 1, BOT: 2 } as const;

export interface CdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  image_item?: { media?: CdnMedia; aeskey?: string; thumb_media?: CdnMedia; hd_size?: number; mid_size?: number };
  voice_item?: { media?: CdnMedia; text?: string; playtime?: number; encode_type?: number; sample_rate?: number };
  file_item?: { media?: CdnMedia; file_name?: string };
  video_item?: { media?: CdnMedia };
}

export interface WeixinMessage {
  message_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  message_type?: number;
  create_time_ms?: number;
  context_token?: string;
  item_list?: MessageItem[];
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export type QrStatus =
  | "wait"
  | "scaned"
  | "need_verifycode"
  | "verify_code_blocked"
  | "expired"
  | "scaned_but_redirect"
  | "binded_redirect"
  | "confirmed";

export interface QrStatusResp {
  status: QrStatus;
  redirect_host?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
}

function randomUin() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return btoa(String(n));
}

const baseInfo = () => ({ channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT });

function commonHeaders(): Record<string, string> {
  return { "iLink-App-Id": APP_ID, "iLink-App-ClientVersion": CLIENT_VERSION };
}

/** message_id 等是 uint64，JSON.parse 会丢精度：先给这些字段的数字加上引号 */
export function parseJson<T>(raw: string): T {
  return JSON.parse(raw.replace(/("(?:message_id|msg_id|svr_id)"\s*:\s*)(-?\d+)/g, '$1"$2"')) as T;
}

async function post<T>(baseUrl: string, endpoint: string, body: unknown, token: string | null, timeoutMs: number): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomUin(),
    ...commonHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  return parseJson<T>(text);
}

export async function getQrCode(): Promise<{ qrcode: string; qrcode_img_content: string }> {
  return post(ILINK_BASE, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, { local_token_list: [] }, null, 15_000);
}

/** 长轮询扫码状态；超时按 wait 处理 */
export async function getQrStatus(host: string | null, qrcode: string, verifyCode: string | null, timeoutMs: number): Promise<QrStatusResp> {
  const base = host ? `https://${host}/` : ILINK_BASE + "/";
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    const res = await fetch(new URL(endpoint, base), { headers: commonHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) throw new Error(`get_qrcode_status ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as QrStatusResp;
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { status: "wait" };
    throw e;
  }
}

export async function getUpdates(baseUrl: string, token: string, cursor: string, timeoutMs: number): Promise<GetUpdatesResp> {
  try {
    return await post<GetUpdatesResp>(baseUrl, "ilink/bot/getupdates", { get_updates_buf: cursor, base_info: baseInfo() }, token, timeoutMs);
  } catch (e) {
    // 长轮询超时是正常情况
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ret: 0, msgs: [], get_updates_buf: cursor };
    throw e;
  }
}

export async function sendText(baseUrl: string, token: string, to: string, text: string, contextToken?: string) {
  const resp = await post<{ ret?: number; errmsg?: string }>(
    baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: `yaf-${crypto.randomUUID()}`,
        message_type: MessageType.BOT,
        message_state: 2,
        item_list: [{ type: ItemType.TEXT, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: baseInfo(),
    },
    token,
    15_000,
  );
  if (resp.ret && resp.ret !== 0) throw new Error(`sendmessage ret=${resp.ret} ${resp.errmsg ?? ""}`);
}

export async function notify(baseUrl: string, token: string, kind: "notifystart" | "notifystop") {
  try {
    await post(baseUrl, `ilink/bot/msg/${kind}`, { base_info: baseInfo() }, token, 10_000);
  } catch (e) {
    console.warn(`wechat ${kind} failed`, e);
  }
}

// ---------- 媒体 ----------

/** aes_key 有两种编码：base64(16 字节) 或 base64(32 位 hex) */
export function parseAesKey(b64: string): Uint8Array {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (raw.length === 16) return raw;
  const s = new TextDecoder().decode(raw);
  if (raw.length === 32 && /^[0-9a-f]{32}$/i.test(s)) return Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
  throw new Error(`bad aes_key length ${raw.length}`);
}

export function hexToB64(hex: string) {
  return btoa(String.fromCharCode(...hex.match(/../g)!.map((h) => parseInt(h, 16))));
}

export async function downloadMedia(media: CdnMedia): Promise<Uint8Array> {
  const url = media.full_url || `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param ?? "")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`cdn download ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
