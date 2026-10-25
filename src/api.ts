export interface Memo {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  /** web | wechat | api | mcp | cli */
  source: string;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  kind: "image" | "voice";
  mime: string | null;
  durationMs: number | null;
  description: string | null;
  hasFile: boolean;
  playable: boolean;
}

export interface WechatRules {
  autoTag: boolean;
  keepAudio: boolean;
  replyConfirm: boolean;
  mergeWindow: boolean;
}

export interface WechatState {
  status: "none" | "pending" | "active" | "error" | "unbound";
  botId?: string | null;
  rules: WechatRules;
  lastEventAt?: number | null;
  lastError?: string | null;
  connectedAt?: number | null;
  qrExpiresAt?: number | null;
  mediaEnabled: boolean;
}

export type QrPollStatus =
  | "wait"
  | "scaned"
  | "need_verifycode"
  | "verify_code_blocked"
  | "expired"
  | "confirmed"
  | "already_bound"
  | "error"
  | "none";

export type SearchMode = "hybrid" | "keyword" | "semantic";
export type SearchSort = "relevance" | "time";

export interface SearchMatch {
  keywordRank?: number;
  semanticScore?: number;
}

export interface MemoHit extends Memo {
  match?: SearchMatch;
}

export interface SearchStats {
  total: number;
  keyword: number;
  semantic: number;
}

export interface IndexStatus {
  total: number;
  indexed: number;
  running: boolean;
  jobStatus: string | null;
  jobStartedAt: number | null;
  model: string;
  fusion: string;
}

export type Cadence = "daily" | "weekly" | "monthly" | "custom";
export type Perspective = "balanced" | "patterns" | "actions" | "questions";

export interface InsightPlan {
  id: string;
  name: string;
  cadence: Cadence;
  cron: string;
  time: string | null;
  weekday: number | null;
  monthday: number | null;
  timezone: string;
  scopeTags: string[];
  windowDays: number;
  perspective: Perspective;
  extraPrompt: string;
  model: "workers-ai" | "claude";
  delivery: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  createdAt: number;
}

export type PlanInput = Partial<Omit<InsightPlan, "id" | "nextRunAt" | "lastRunAt" | "createdAt" | "delivery">>;

export interface InsightItem {
  title: string;
  detail: string;
  memoIds: string[];
}

export interface InsightContent {
  summary: string;
  themes: InsightItem[];
  connections: InsightItem[];
  unfinished: InsightItem[];
  questions: { question: string; why: string; memoIds: string[] }[];
  memos: Record<string, { createdAt: number; excerpt: string }>;
  stats: { window: number; history: number; clusters: number; dropped: number };
}

export interface Insight {
  id: string;
  planId: string | null;
  planName: string | null;
  status: "generating" | "ready" | "failed";
  title: string | null;
  periodStart: number;
  periodEnd: number;
  memoCount: number;
  model: string | null;
  error: string | null;
  feedback: "useful" | "useless" | null;
  readAt: number | null;
  savedMemoId: string | null;
  createdAt: number;
  completedAt: number | null;
  content?: InsightContent | null;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface Stats {
  totals: { memos: number; tags: number; days: number };
  heatmap: { day: string; count: number }[];
}

export type Scope = "memos:read" | "memos:write" | "export" | "insights:read";

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

function qs(params: Record<string, string | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  status: () => request<{ needsSetup: boolean; setupTokenRequired: boolean }>("/auth/status"),
  me: () => request<{ user: User }>("/auth/me"),
  setup: (body: { email: string; password: string; name?: string; setupToken?: string }) =>
    request("/auth/setup", { method: "POST", body: json(body) }),
  login: (email: string, password: string) =>
    request("/auth/login", { method: "POST", body: json({ email, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),

  listMemos: (params: { q?: string; tag?: string; cursor?: string | null; mode?: SearchMode; sort?: SearchSort }) =>
    request<{ memos: MemoHit[]; nextCursor: string | null; stats?: SearchStats }>(`/memos${qs(params)}`),
  related: (id: string) => request<{ memos: (Memo & { score: number })[] }>(`/memos/${id}/related`),
  searchStatus: () => request<IndexStatus>("/search/status"),
  reindex: (full: boolean) => request<IndexStatus>("/search/reindex", { method: "POST", body: json({ full }) }),
  createMemo: (content: string) => request<{ memo: Memo }>("/memos", { method: "POST", body: json({ content }) }),
  updateMemo: (id: string, content: string) =>
    request<{ memo: Memo }>(`/memos/${id}`, { method: "PATCH", body: json({ content }) }),
  deleteMemo: (id: string) => request(`/memos/${id}`, { method: "DELETE" }),
  tags: () => request<{ tags: TagCount[] }>("/tags"),
  stats: () => request<Stats>(`/stats?tz=${new Date().getTimezoneOffset()}`),
  changePassword: (current: string, next: string) =>
    request("/auth/password", { method: "POST", body: json({ current, next }) }),
  sessions: () => request<{ count: number }>("/auth/sessions"),
  revokeOtherSessions: () => request<{ revoked: number }>("/auth/sessions/revoke-others", { method: "POST" }),

  listTokens: () => request<{ tokens: ApiToken[] }>("/tokens"),
  createToken: (body: { name: string; scopes: Scope[]; expiresInDays: number | null }) =>
    request<{ token: string; info: ApiToken }>("/tokens", { method: "POST", body: json(body) }),
  revokeToken: (id: string) => request(`/tokens/${id}`, { method: "DELETE" }),

  getDevice: (code: string) =>
    request<{ clientName: string; scopes: Scope[]; status: string }>(`/device/${encodeURIComponent(code)}`),
  approveDevice: (code: string, approve: boolean) =>
    request(`/device/${encodeURIComponent(code)}`, { method: "POST", body: json({ approve }) }),

  getMemo: (id: string) => request<{ memo: Memo }>(`/memos/${id}`),

  listPlans: () => request<{ plans: InsightPlan[] }>("/insights/plans"),
  createPlan: (body: PlanInput) => request<{ plan: InsightPlan }>("/insights/plans", { method: "POST", body: json(body) }),
  updatePlan: (id: string, body: PlanInput) =>
    request<{ plan: InsightPlan }>(`/insights/plans/${id}`, { method: "PATCH", body: json(body) }),
  deletePlan: (id: string) => request(`/insights/plans/${id}`, { method: "DELETE" }),
  runPlan: (id: string) => request<{ id: string; alreadyRunning?: boolean }>(`/insights/plans/${id}/run`, { method: "POST" }),
  listInsights: () => request<{ insights: Insight[]; unread: number }>("/insights"),
  getInsight: (id: string) => request<{ insight: Insight }>(`/insights/${id}`),
  insightFeedback: (id: string, feedback: "useful" | "useless" | null) =>
    request(`/insights/${id}/feedback`, { method: "POST", body: json({ feedback }) }),
  saveInsight: (id: string) => request<{ memoId: string }>(`/insights/${id}/save`, { method: "POST" }),
  deleteInsight: (id: string) => request(`/insights/${id}`, { method: "DELETE" }),
  aiSettings: () => request<{ hasClaudeKey: boolean; workersAiModel: string; claudeModel: string }>("/settings/ai"),
  setClaudeKey: (anthropicKey: string | null) =>
    request<{ hasClaudeKey: boolean }>("/settings/ai", { method: "PUT", body: json({ anthropicKey }) }),

  wechat: () => request<WechatState>("/wechat"),
  wechatQrcode: () => request<{ qrContent: string; expiresAt: number }>("/wechat/qrcode", { method: "POST" }),
  wechatQrStatus: () => request<{ status: QrPollStatus; retry?: boolean; error?: string }>("/wechat/qrcode/status"),
  wechatVerify: (code: string) => request("/wechat/qrcode/verify", { method: "POST", body: json({ code }) }),
  wechatRules: (rules: Partial<WechatRules>) =>
    request<{ rules: WechatRules }>("/wechat/rules", { method: "PATCH", body: json(rules) }),
  wechatUnbind: () => request("/wechat", { method: "DELETE" }),
  attachmentUrl: (id: string, playback = false) => `/api/attachments/${id}${playback ? "?playback=1" : ""}`,

  exportUrl: (params: { tag?: string; format: "md" | "json" }) => `/api/export${qs(params)}`,
};
