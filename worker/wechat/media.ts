// 微信图片 / 语音：下载 → AES-128-ECB 解密 → 存 R2（若已绑定）→ 图片描述 → 记录附件。
import { ecb } from "@noble/ciphers/aes.js";
import type { Env } from "../env";
import { downloadMedia, hexToB64, ItemType, parseAesKey, type CdnMedia, type MessageItem } from "./protocol";

// 图片描述：Qwen3.8 27B，关掉思考（开着会先写推理，200 token 内正文被截断，用量翻倍）。
// 2026-10-26 实测：认字最完整，约 2–3 秒、30–45 neurons 一张；更便宜的备选是 @cf/google/gemma-4-26b-a4b-it（约 4 neurons）
export const VISION_MODEL = "@cf/qwen/qwen3.8-27b";

function sniffImage(b: Uint8Array): { mime: string; ext: string } {
  if (b[0] === 0xff && b[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50) return { mime: "image/png", ext: "png" };
  if (b[0] === 0x47 && b[1] === 0x49) return { mime: "image/gif", ext: "gif" };
  if (b[8] === 0x57 && b[9] === 0x45) return { mime: "image/webp", ext: "webp" };
  return { mime: "application/octet-stream", ext: "bin" };
}

async function fetchDecrypted(media: CdnMedia, keyB64: string | undefined) {
  const data = await downloadMedia(media);
  return keyB64 ? ecb(parseAesKey(keyB64)).decrypt(data) : data;
}

function toBase64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function describeImage(env: Env, bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    const res = (await env.AI.run(VISION_MODEL as keyof AiModels, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "用中文描述这张图片（60 字以内）。如果图里有文字，摘录关键文字。只输出描述本身。" },
            { type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } },
          ],
        },
      ],
      max_tokens: 300,
      chat_template_kwargs: { enable_thinking: false },
    } as never)) as { response?: string; choices?: { message?: { content?: string | null } }[] };
    // 不同模型返回格式不同：Workers AI 原生格式是 response，OpenAI 兼容格式是 choices
    const text = res.response ?? res.choices?.[0]?.message?.content ?? "";
    return text.trim() || null;
  } catch (e) {
    console.warn("describe image failed", e);
    return null;
  }
}

export async function saveMedia(
  env: Env,
  userId: string,
  memoId: string,
  items: MessageItem[],
  opts: { keepAudio: boolean },
) {
  for (const it of items) {
    const attId = crypto.randomUUID();
    if (it.type === ItemType.IMAGE && it.image_item?.media) {
      const img = it.image_item;
      const key = img.aeskey ? hexToB64(img.aeskey) : img.media!.aes_key;
      const bytes = await fetchDecrypted(img.media!, key);
      const { mime, ext } = sniffImage(bytes);
      let r2Key: string | null = null;
      if (env.MEDIA) {
        r2Key = `u/${userId}/${memoId}/${attId}.${ext}`;
        await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: mime } });
      }
      const description = await describeImage(env, bytes, mime);
      await env.DB.prepare(
        `INSERT INTO attachments (id, memo_id, user_id, kind, r2_key, mime, size, description, created_at)
         VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?)`,
      )
        .bind(attId, memoId, userId, r2Key, mime, bytes.length, description, Date.now())
        .run();
    } else if (it.type === ItemType.VOICE && it.voice_item) {
      const v = it.voice_item;
      let r2Key: string | null = null;
      let size: number | null = null;
      if (opts.keepAudio && env.MEDIA && v.media && v.media.aes_key) {
        const bytes = await fetchDecrypted(v.media, v.media.aes_key);
        r2Key = `u/${userId}/${memoId}/${attId}.silk`;
        size = bytes.length;
        await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: "audio/silk" } });
      }
      const text = v.text?.trim() || null;
      await env.DB.prepare(
        `INSERT INTO attachments (id, memo_id, user_id, kind, r2_key, mime, size, duration_ms, description, created_at)
         VALUES (?, ?, ?, 'voice', ?, 'audio/silk', ?, ?, ?, ?)`,
      )
        .bind(attId, memoId, userId, r2Key, size, v.playtime ?? null, text, Date.now())
        .run();
    }
  }
}
