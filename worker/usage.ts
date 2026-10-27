// AI 用量：按需查 GraphQL Analytics API（aiInferenceAdaptiveGroups），缓存 5 分钟。
// 统计的是整个账户当天（UTC）的 Workers AI neurons，不只是 yaf 自己的调用。
import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { requireUser } from "./auth";
import { EMBED_MODEL } from "./search";
import { CLEF_MODEL } from "./judge";
import { VISION_MODEL } from "./wechat/media";
import { WORKERS_AI_MODEL } from "./insight-engine";

/** Workers AI 每天免费 neurons，UTC 0 点重置 */
const DAILY_FREE = 10_000;
const CACHE_TTL = 300;

/** modelId → 功能；没列出的模型算「其他」 */
const FEATURES: { key: string; label: string; models: string[] }[] = [
  { key: "embed", label: "向量", models: [EMBED_MODEL] },
  { key: "vision", label: "图片描述", models: [VISION_MODEL] },
  { key: "insight", label: "洞察", models: [WORKERS_AI_MODEL] },
  { key: "judge", label: "分类", models: [CLEF_MODEL] },
];

export interface AiUsage {
  total: number;
  limit: number;
  plan: "free" | "paid";
  parts: { key: string; label: string; neurons: number }[];
  resetAt: number;
  updatedAt: number;
}

const QUERY = `query($account: String!, $date: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    aiInferenceAdaptiveGroups(limit: 1000, filter: { date: $date }) {
      sum { totalNeurons }
      dimensions { modelId }
    }
  } }
}`;

async function fetchUsage(env: Env): Promise<AiUsage> {
  const now = new Date();
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { account: env.CF_ACCOUNT_ID, date: now.toISOString().slice(0, 10) } }),
  });
  const body = await res.json<{
    data?: { viewer: { accounts: { aiInferenceAdaptiveGroups: { sum: { totalNeurons: number }; dimensions: { modelId: string } }[] }[] } };
    errors?: { message: string }[] | null;
  }>();
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(`GraphQL ${res.status}: ${body.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
  }
  const sums = new Map<string, number>();
  for (const g of body.data.viewer.accounts[0]?.aiInferenceAdaptiveGroups ?? []) {
    const f = FEATURES.find((f) => f.models.includes(g.dimensions.modelId));
    const key = f?.key ?? "other";
    sums.set(key, (sums.get(key) ?? 0) + g.sum.totalNeurons);
  }
  const parts = [...FEATURES, { key: "other", label: "其他" }]
    .map((f) => ({ key: f.key, label: f.label, neurons: Math.round(sums.get(f.key) ?? 0) }))
    .filter((p) => p.neurons > 0);
  const resetAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return {
    total: parts.reduce((s, p) => s + p.neurons, 0),
    limit: DAILY_FREE,
    plan: env.AI_PLAN === "paid" ? "paid" : "free",
    parts,
    resetAt,
    updatedAt: now.getTime(),
  };
}

export const usage = new Hono<AppEnv>();

/** 未配置 CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN 时返回 null，前端不显示圆环 */
usage.get("/usage/ai", requireUser, async (c) => {
  if (c.get("user").role !== "admin") return c.json({ error: "无权限" }, 403);
  const env = c.env;
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return c.json({ usage: null });
  // 缓存键带上日期，跨 UTC 0 点自然失效
  const key = new Request(`https://yaf.internal/usage/ai/${new Date().toISOString().slice(0, 10)}`);
  // tsconfig 同时带 DOM 类型，CacheStorage 上没有 Workers 的 default
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key);
  if (hit) return c.json({ usage: await hit.json<AiUsage>() });
  const data = await fetchUsage(env);
  c.executionCtx.waitUntil(
    cache.put(key, new Response(JSON.stringify(data), { headers: { "Cache-Control": `max-age=${CACHE_TTL}` } })),
  );
  return c.json({ usage: data });
});
