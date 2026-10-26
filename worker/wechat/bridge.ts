// WechatBridge：每个绑定一个 Durable Object 实例，用 alarm 循环长轮询 getupdates。
// DO 单实例、串行执行，保证游标不会被并发推进；按消息 id 去重，重复投递也只收录一次。
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { open } from "../lib/secret-box";
import { createMemo, updateMemo } from "../memo-service";
import { scheduleIndex } from "../search";
import { extractTags } from "../../shared/tags";
import { appendTags } from "../auto-tags";
import { getUpdates, ItemType, MessageType, notify, sendText, STALE_TOKEN, type WeixinMessage } from "./protocol";
import { saveMedia } from "./media";

export interface WechatRules {
  /** 自动追加标签（默认关闭；来源已由卡片上的图标标出） */
  autoTag: boolean;
  /** 自动追加的标签，不带 # */
  autoTags: string[];
  /** 语音保留原音频（存 R2） */
  keepAudio: boolean;
  /** 收录后回复「已记录」 */
  replyConfirm: boolean;
  /** 2 分钟内的连续文字消息合并成一条 memo */
  mergeWindow: boolean;
}

export const DEFAULT_RULES: WechatRules = {
  autoTag: false,
  autoTags: ["微信"],
  keepAudio: true,
  replyConfirm: true,
  mergeWindow: false,
};
const MERGE_MS = 2 * 60_000;
const POLL_TIMEOUT_MS = 30_000;
const SEEN_KEEP = 2000;

interface BindingRow {
  user_id: string;
  status: string;
  bot_token_enc: string | null;
  wechat_user_id: string | null;
  base_url: string | null;
  rules: string;
}

export class WechatBridge extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    });
  }

  /** 绑定成功后调用：开始轮询 */
  async start(userId: string) {
    await this.ctx.storage.put("userId", userId);
    await this.ctx.storage.delete(["cursor", "lastMemo", "failures"]);
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** 解绑：停止轮询并清空状态 */
  async stop() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** 设置页显示用 */
  async info() {
    return {
      running: (await this.ctx.storage.getAlarm()) !== null,
      cursor: Boolean(await this.ctx.storage.get("cursor")),
    };
  }

  async alarm() {
    const userId = await this.ctx.storage.get<string>("userId");
    if (!userId) return;
    const binding = await this.env.DB.prepare(
      "SELECT user_id, status, bot_token_enc, wechat_user_id, base_url, rules FROM wechat_bindings WHERE user_id = ?",
    )
      .bind(userId)
      .first<BindingRow>();
    if (!binding || binding.status !== "active" || !binding.bot_token_enc || !binding.base_url) {
      await this.stop();
      return;
    }

    try {
      const token = await open(this.env.ENCRYPTION_KEY, binding.bot_token_enc);
      const cursor = (await this.ctx.storage.get<string>("cursor")) ?? "";
      const resp = await getUpdates(binding.base_url, token, cursor, POLL_TIMEOUT_MS);

      if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
        if (resp.ret === STALE_TOKEN || resp.errcode === STALE_TOKEN) {
          await this.setStatus(userId, "error", "微信连接已失效（bot_token 过期或在别处重新绑定），请解绑后重新扫码。");
          await this.ctx.storage.deleteAlarm();
          return;
        }
        throw new Error(`getupdates ret=${resp.ret} errcode=${resp.errcode} ${resp.errmsg ?? ""}`);
      }

      if (resp.get_updates_buf) await this.ctx.storage.put("cursor", resp.get_updates_buf);
      const rules: WechatRules = { ...DEFAULT_RULES, ...JSON.parse(binding.rules || "{}") };
      for (const msg of resp.msgs ?? []) {
        try {
          await this.handle(userId, binding, token, rules, msg);
        } catch (e) {
          console.error("wechat message failed", msg.message_id, e);
        }
      }
      if (resp.msgs?.length) {
        await this.env.DB.prepare("UPDATE wechat_bindings SET last_event_at = ?, last_error = NULL WHERE user_id = ?")
          .bind(Date.now(), userId)
          .run();
      }
      await this.ctx.storage.put("failures", 0);
      await this.ctx.storage.setAlarm(Date.now() + 200);
    } catch (e) {
      // 网络或接口错误：退避重试，连续失败时记录到设置页
      const failures = ((await this.ctx.storage.get<number>("failures")) ?? 0) + 1;
      await this.ctx.storage.put("failures", failures);
      const message = e instanceof Error ? e.message : String(e);
      console.error("wechat poll failed", failures, message);
      if (failures >= 3) {
        await this.env.DB.prepare("UPDATE wechat_bindings SET last_error = ?, updated_at = ? WHERE user_id = ?")
          .bind(`轮询失败（第 ${failures} 次）：${message.slice(0, 200)}`, Date.now(), userId)
          .run();
      }
      await this.ctx.storage.setAlarm(Date.now() + Math.min(failures * 10_000, 120_000));
    }
  }

  private async setStatus(userId: string, status: string, error: string | null) {
    await this.env.DB.prepare("UPDATE wechat_bindings SET status = ?, last_error = ?, updated_at = ? WHERE user_id = ?")
      .bind(status, error, Date.now(), userId)
      .run();
  }

  /** 按消息 id 去重；返回 true 表示第一次见到 */
  private firstSeen(id: string) {
    const sql = this.ctx.storage.sql;
    const before = sql.exec("SELECT 1 FROM seen WHERE id = ?", id).toArray().length;
    if (before) return false;
    sql.exec("INSERT INTO seen (id, at) VALUES (?, ?)", id, Date.now());
    sql.exec("DELETE FROM seen WHERE id NOT IN (SELECT id FROM seen ORDER BY at DESC LIMIT ?)", SEEN_KEEP);
    return true;
  }

  private async handle(userId: string, binding: BindingRow, token: string, rules: WechatRules, msg: WeixinMessage) {
    if (msg.message_type === MessageType.BOT) return;
    // 只收录绑定者本人发来的消息
    if (binding.wechat_user_id && msg.from_user_id && msg.from_user_id !== binding.wechat_user_id) {
      console.warn("wechat: ignore message from other user");
      return;
    }
    const id = msg.message_id ?? `${msg.from_user_id}-${msg.create_time_ms}`;
    if (!this.firstSeen(id)) return;

    const items = msg.item_list ?? [];
    // 正文只放用户说的话：文字和语音转写。图片、语音本身作为附件展示，不再写 [图片] 之类的占位。
    // 文件和视频还不保存原文件，只能在正文里留个记号。
    const texts: string[] = [];
    for (const it of items) {
      if (it.type === ItemType.TEXT && it.text_item?.text?.trim()) texts.push(it.text_item.text.trim());
      else if (it.type === ItemType.VOICE && it.voice_item?.text?.trim()) texts.push(it.voice_item.text.trim());
      else if (it.type === ItemType.FILE) texts.push(`[文件] ${it.file_item?.file_name ?? ""}`.trim());
      else if (it.type === ItemType.VIDEO) texts.push("[视频]");
    }
    const hasMedia = items.some((it) => it.type === ItemType.IMAGE || it.type === ItemType.VOICE);
    if (!texts.length && !hasMedia) return;
    const body = texts.join("\n");
    const tags = rules.autoTag ? rules.autoTags : [];
    const now = Date.now();

    // 合并连续文字消息
    // raw 是没加自动标签的正文，合并时在它后面接新内容，再统一加标签
    const last = await this.ctx.storage.get<{ id: string; at: number; raw?: string; media?: boolean }>("lastMemo");
    let memo;
    let raw = body;
    if (rules.mergeWindow && !hasMedia && last?.raw && !last.media && now - last.at < MERGE_MS) {
      raw = `${last.raw}\n${body}`;
      try {
        memo = await updateMemo(this.env.DB, userId, last.id, appendTags(raw, tags));
      } catch {
        memo = null; // 原 memo 已被删除，新建一条
        raw = body;
      }
    }
    if (!memo) memo = await createMemo(this.env.DB, userId, appendTags(body, tags), "wechat", { allowEmpty: hasMedia });
    await this.ctx.storage.put("lastMemo", { id: memo.id, at: now, raw, media: hasMedia });

    if (hasMedia) {
      // 下载、解密、存 R2、图片描述 / 语音转写，完成后再重算向量
      this.ctx.waitUntil(
        saveMedia(this.env, userId, memo.id, items, { keepAudio: rules.keepAudio })
          .catch(async (e) => {
            console.error("wechat media failed", e);
            // 什么都没存下来时留一句说明，避免出现空白卡片
            if (!memo.content.trim()) await updateMemo(this.env.DB, userId, memo.id, "（微信图片 / 语音保存失败）").catch(() => {});
          })
          .then(() => scheduleIndex(this.env, this.ctx, userId, memo)),
      );
    } else scheduleIndex(this.env, this.ctx, userId, memo);

    if (rules.replyConfirm && msg.from_user_id) {
      const tags = extractTags(memo.content);
      const reply = `已记录${tags.length ? " · " + tags.map((t) => "#" + t).join(" ") : ""}`;
      this.ctx.waitUntil(
        sendText(binding.base_url!, token, msg.from_user_id, reply, msg.context_token).catch((e) =>
          console.warn("wechat reply failed", e),
        ),
      );
    }
  }
}

/** 解绑时通知微信端停止推送（失败忽略） */
export async function notifyStop(env: Env, row: { bot_token_enc: string | null; base_url: string | null }) {
  if (!row.bot_token_enc || !row.base_url) return;
  try {
    await notify(row.base_url, await open(env.ENCRYPTION_KEY, row.bot_token_enc), "notifystop");
  } catch {
    /* 忽略 */
  }
}
