// 按来源自动加标签。CLI / API / MCP 的配置存在 user_settings.auto_tags，微信的在 wechat_bindings.rules。
import { Hono } from "hono";
import { extractTags, normalizeTag } from "../shared/tags";
import type { AppEnv, Source } from "./env";
import { requireUser } from "./auth";

export const CHANNELS = ["cli", "api", "mcp"] as const;
export type Channel = (typeof CHANNELS)[number];
export interface AutoTag {
  on: boolean;
  tags: string[];
}
export type ChannelTags = Record<Channel, AutoTag>;

const MAX_TAGS = 10;
const DEFAULT_TAGS: Record<Channel, string> = { cli: "cli", api: "api", mcp: "mcp" };

/** 清洗用户填的标签：去掉 #、空白和尾部标点，去重，最多 10 个 */
export function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    const t = normalizeTag(String(raw ?? "").trim().replace(/^#+/, "").replace(/\s+/g, ""));
    if (t && !t.includes("#")) out.add(t);
  }
  return [...out].slice(0, MAX_TAGS);
}

/** 把内容里还没有的标签追加到末尾 */
export function appendTags(content: string, tags: string[]): string {
  const have = new Set(extractTags(content));
  const missing = tags.filter((t) => !have.has(t));
  if (!missing.length) return content;
  return [content.trimEnd(), missing.map((t) => "#" + t).join(" ")].filter(Boolean).join(" ");
}

function parse(raw: string | null | undefined): ChannelTags {
  let saved: Partial<Record<Channel, Partial<AutoTag>>> = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    /* 忽略损坏的配置 */
  }
  const out = {} as ChannelTags;
  for (const ch of CHANNELS) {
    const s = saved[ch] ?? {};
    const tags = cleanTags(s.tags);
    out[ch] = { on: s.on === true, tags: tags.length ? tags : [DEFAULT_TAGS[ch]] };
  }
  return out;
}

export async function getChannelTags(db: D1Database, userId: string): Promise<ChannelTags> {
  const row = await db.prepare("SELECT auto_tags FROM user_settings WHERE user_id = ?").bind(userId).first<{ auto_tags: string | null }>();
  return parse(row?.auto_tags);
}

/** 新建 memo 前调用：按来源追加配置的标签 */
export async function withChannelTags(db: D1Database, userId: string, source: Source, content: string): Promise<string> {
  // 空内容留给 createMemo 报错，不能只靠自动标签凑出一条 memo
  if (!(CHANNELS as readonly string[]).includes(source) || !String(content ?? "").trim()) return content;
  const cfg = (await getChannelTags(db, userId))[source as Channel];
  return cfg.on ? appendTags(content, cfg.tags) : content;
}

export const autoTags = new Hono<AppEnv>();

autoTags.get("/settings/auto-tags", requireUser, async (c) => c.json(await getChannelTags(c.env.DB, c.get("user").id)));

autoTags.put("/settings/auto-tags", requireUser, async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json<Partial<Record<Channel, Partial<AutoTag>>>>();
  const cfg = await getChannelTags(c.env.DB, userId);
  for (const ch of CHANNELS) {
    const b = body[ch];
    if (!b) continue;
    if (typeof b.on === "boolean") cfg[ch].on = b.on;
    if (b.tags !== undefined) {
      const tags = cleanTags(b.tags);
      if (!tags.length) return c.json({ error: "至少保留一个标签" }, 400);
      cfg[ch].tags = tags;
    }
  }
  await c.env.DB.prepare(
    `INSERT INTO user_settings (user_id, auto_tags, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET auto_tags = excluded.auto_tags, updated_at = excluded.updated_at`,
  )
    .bind(userId, JSON.stringify(cfg), Date.now())
    .run();
  return c.json(cfg);
});
