/**
 * Workers AI 洞察可选模型清单（基于 Cloudflare 官方目录、定价与 2026-11-20 下线公告）。
 *
 * thinking（思考 / 推理控制，对应官方 schema 的 `chat_template_kwargs.enable_thinking`）：
 * - "toggle"：官方接口支持 `enable_thinking: boolean`（默认开启，可传 false 关闭）
 * - "always"：官方接口固定 `enable_thinking: true`，不支持关闭
 * - "none"  ：标准非推理模型，或官方接口无 `enable_thinking` 参数
 */
export type ThinkingSupport = "toggle" | "always" | "none";

export interface InsightModelInfo {
  id: string;
  name: string;
  vendor: string;
  params: string;
  context: string;
  paidOnly?: boolean;
  recommended?: boolean;
  /** 废弃日期（YYYY-MM-DD）；存在即表示即将或已经下线 */
  deprecated?: string;
  thinking: ThinkingSupport;
  summary: string;
}

/** 新用户 / 首次启用洞察时的默认模型 */
export const DEFAULT_INSIGHT_MODEL = "@cf/qwen/qwen3.8-27b";

/** 旧版写死的默认模型：已有洞察计划但未手动修改过的老用户保持此值（不静默替换，由界面提醒用户手动切换） */
export const LEGACY_INSIGHT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

export const INSIGHT_MODELS: InsightModelInfo[] = [
  // ---------- 免费套餐可用（共享每日 10,000 免费 Neurons） ----------
  {
    id: "@cf/qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B",
    vendor: "Alibaba",
    params: "27B",
    context: "256K",
    recommended: true,
    thinking: "toggle",
    summary: "中文理解与结构化输出最稳，官方主力替代",
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    name: "Gemma 4 26B A4B",
    vendor: "Google",
    params: "MoE · 4B 激活",
    context: "256K",
    recommended: true,
    thinking: "toggle",
    summary: "轻量激活参数，响应快、极省 Neurons 用量",
  },
  {
    id: "@cf/zai-org/glm-4.7-flash",
    name: "GLM 4.7 Flash",
    vendor: "Zhipu",
    params: "MoE · 3B 激活",
    context: "128K",
    thinking: "toggle",
    summary: "智谱高速多语言模型，中文表达自然",
  },
  {
    id: "@cf/moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    vendor: "Moonshot",
    params: "K2.5",
    context: "128K",
    thinking: "toggle",
    summary: "擅长中文长文归纳与跨段落关联",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B Fast",
    vendor: "Meta",
    params: "70B FP8",
    context: "128K",
    thinking: "none",
    summary: "原生支持 JSON Schema，无额外推理耗时",
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    name: "Mistral Small 3.1 24B",
    vendor: "Mistral",
    params: "24B",
    context: "128K",
    thinking: "none",
    summary: "标准指令模型，响应稳定",
  },
  {
    id: "@cf/google/gemma-3-12b-it",
    name: "Gemma 3 12B IT",
    vendor: "Google",
    params: "12B",
    context: "128K",
    thinking: "none",
    summary: "小体积指令模型，适合短周期少笔记总结",
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B",
    vendor: "Meta",
    params: "MoE · 17B",
    context: "128K",
    thinking: "none",
    summary: "生成速度快，中文报告内容偏简略",
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    vendor: "OpenAI",
    params: "120B",
    context: "128K",
    thinking: "always",
    summary: "开源推理模型，复杂 JSON 偶发解析失败",
  },
  {
    id: "@cf/openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    vendor: "OpenAI",
    params: "20B",
    context: "128K",
    thinking: "always",
    summary: "轻量开源推理模型",
  },

  // ---------- 需 Paid 套餐（Workers Paid 专属） ----------
  {
    id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    name: "DeepSeek V4.1 Flash",
    vendor: "DeepSeek",
    params: "V4.1",
    context: "1M",
    paidOnly: true,
    recommended: true,
    thinking: "toggle",
    summary: "百万上下文旗舰 Flash，官方推荐替代",
  },
  {
    id: "@cf/zai-org/glm-5.3",
    name: "GLM 5.3",
    vendor: "Zhipu",
    params: "GLM-5.3",
    context: "1M",
    paidOnly: true,
    recommended: true,
    thinking: "always",
    summary: "智谱百万上下文旗舰推理模型",
  },

  // ---------- 即将 / 已废弃（2026-11-20 官方下线，返回 410 Gone） ----------
  {
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    name: "Qwen 3 30B A3B",
    vendor: "Alibaba",
    params: "MoE · 3B 激活",
    context: "32K",
    deprecated: "2026-11-20",
    thinking: "none",
    summary: "yaf 旧默认模型，下线后请求将返回 410 错误",
  },
  {
    id: "@cf/qwen/qwq-32b",
    name: "QwQ 32B",
    vendor: "Alibaba",
    params: "32B",
    context: "32K",
    deprecated: "2026-11-20",
    thinking: "always",
    summary: "早期推理模型，即将下线",
  },
  {
    id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    name: "DeepSeek R1 Distill Qwen 32B",
    vendor: "DeepSeek",
    params: "32B",
    context: "32K",
    deprecated: "2026-11-20",
    thinking: "always",
    summary: "早期蒸馏推理模型，即将下线",
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash (0731)",
    vendor: "DeepSeek",
    params: "V4",
    context: "128K",
    paidOnly: true,
    deprecated: "2026-11-20",
    thinking: "toggle",
    summary: "旧版快照，由 DeepSeek V4.1 Flash 替代",
  },
  {
    id: "@cf/zai-org/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    vendor: "Zhipu",
    params: "MoE · 18B 激活",
    context: "1M",
    paidOnly: true,
    deprecated: "2026-11-20",
    thinking: "always",
    summary: "过渡版本，由 GLM 5.3 或 GLM 4.7 Flash 替代",
  },
  {
    id: "@cf/moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    vendor: "Moonshot",
    params: "K2.6",
    context: "128K",
    paidOnly: true,
    deprecated: "2026-11-20",
    thinking: "toggle",
    summary: "旧版本，可迁移至 Kimi K2.5",
  },
];

export function findInsightModel(id: string | null | undefined): InsightModelInfo | undefined {
  return INSIGHT_MODELS.find((m) => m.id === id);
}

export function isModelDeprecated(id: string | null | undefined): boolean {
  const m = findInsightModel(id);
  return m ? Boolean(m.deprecated) : false;
}
