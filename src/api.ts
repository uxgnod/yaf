export interface Memo {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
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

  listMemos: (params: { q?: string; tag?: string; cursor?: string | null }) =>
    request<{ memos: Memo[]; nextCursor: string | null }>(`/memos${qs(params)}`),
  createMemo: (content: string) => request<{ memo: Memo }>("/memos", { method: "POST", body: json({ content }) }),
  updateMemo: (id: string, content: string) =>
    request<{ memo: Memo }>(`/memos/${id}`, { method: "PATCH", body: json({ content }) }),
  deleteMemo: (id: string) => request(`/memos/${id}`, { method: "DELETE" }),
  tags: () => request<{ tags: TagCount[] }>("/tags"),
  stats: () => request<Stats>(`/stats?tz=${new Date().getTimezoneOffset()}`),
  exportUrl: (params: { tag?: string; format: "md" | "json" }) => `/api/export${qs(params)}`,
};
