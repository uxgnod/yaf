// 用 Worker secret ENCRYPTION_KEY（32 字节 base64）做 AES-GCM 加密，存库的格式：v1.<iv b64>.<密文 b64>
import { fromB64, toB64 } from "./crypto";

async function key(secret: string | undefined) {
  if (!secret) throw new Error("ENCRYPTION_KEY 未设置（wrangler secret put ENCRYPTION_KEY）");
  return crypto.subtle.importKey("raw", fromB64(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(secret: string | undefined, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(plain));
  return `v1.${toB64(iv)}.${toB64(data)}`;
}

export async function open(secret: string | undefined, sealed: string): Promise<string> {
  const [v, iv, data] = sealed.split(".");
  if (v !== "v1" || !iv || !data) throw new Error("bad sealed value");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(secret), fromB64(data));
  return new TextDecoder().decode(plain);
}
