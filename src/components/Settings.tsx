import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type ApiToken, type Cadence, type IndexStatus, type InsightPlan, type Perspective, type PlanInput, type Scope, type TagCount, type User } from "../api";
import { describeSchedule } from "./Insights";
import { WechatSection } from "./Wechat";
import { navigate } from "../router";
import { useTheme } from "../theme";

const SECTIONS = [
  { path: "/settings/account", icon: "◉", label: "账号与安全" },
  { path: "/settings/tokens", icon: "⌘", label: "API Token" },
  { path: "/settings/wechat", icon: "✉", label: "微信连接" },
  { path: "/settings/insights", icon: "✦", label: "洞察与搜索" },
];

export const SCOPE_LABEL: Record<Scope, string> = {
  "memos:read": "读取 memo",
  "memos:write": "写入 memo",
  export: "导出",
  "insights:read": "读取洞察",
};

export function formatDate(ts: number | null, empty = "—") {
  if (!ts) return empty;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relative(ts: number | null) {
  if (!ts) return "从未使用";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 30 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return formatDate(ts);
}

export function Settings({ user, path }: { user: User; path: string }) {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const current = SECTIONS.find((s) => path.startsWith(s.path)) ?? SECTIONS[0];

  useEffect(() => {
    if (path === "/settings" || path === "/settings/") history.replaceState(null, "", SECTIONS[0].path);
  }, [path]);

  return (
    <div className={"layout" + (open ? " sidebar-open" : "")}>
      <div className="sidebar-scrim" onClick={() => setOpen(false)} />
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="btn btn-ghost btn-sm back-btn" onClick={() => navigate("/")}>← 返回笔记</button>
          <button className="icon-btn" onClick={toggle} title={`主题：${theme}`}>
            {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
          </button>
        </div>
        <div className="section-title">设置</div>
        <nav className="nav">
          {SECTIONS.map((s) => (
            <div
              key={s.path}
              className={"nav-item" + (s === current ? " active" : "")}
              onClick={() => {
                setOpen(false);
                navigate(s.path);
              }}
            >
              <span className="nav-icon">{s.icon}</span> {s.label}
            </div>
          ))}
        </nav>
      </aside>
      <main className="main settings-main">
        <div className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setOpen(true)} aria-label="菜单">☰</button>
          <div className="title">{current.label}</div>
        </div>
        {current.path === "/settings/account" && <AccountSection user={user} />}
        {current.path === "/settings/tokens" && <TokensSection />}
        {current.path === "/settings/wechat" && <WechatSection />}
        {current.path === "/settings/insights" && <InsightsSearchSection />}
      </main>
    </div>
  );
}

export function Card({ title, desc, children, actions }: { title: string; desc?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h3>{title}</h3>
          {desc && <p className="muted small">{desc}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

// ---------- 账号与安全 ----------

function AccountSection({ user }: { user: User }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<number | null>(null);

  const loadSessions = () => api.sessions().then((r) => setSessions(r.count));
  useEffect(() => {
    loadSessions();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) return setMsg({ ok: false, text: "两次输入的新密码不一致" });
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setMsg({ ok: true, text: "密码已更新，其他设备上的登录已失效" });
      setCurrent("");
      setNext("");
      setConfirm("");
      loadSessions();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-stack">
      <Card title="账号">
        <div className="kv">
          <span className="muted">邮箱</span>
          <span>{user.email}</span>
          <span className="muted">昵称</span>
          <span>{user.name || "—"}</span>
          <span className="muted">角色</span>
          <span>{user.role}</span>
        </div>
      </Card>
      <Card title="修改密码" desc="修改成功后，除当前设备外的登录会话都会失效。">
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>当前密码</span>
            <input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </label>
          <label>
            <span>新密码</span>
            <input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="至少 8 位" />
          </label>
          <label>
            <span>确认新密码</span>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          {msg && <div className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</div>}
          <div>
            <button className="btn btn-primary" disabled={busy}>{busy ? "请稍候…" : "更新密码"}</button>
          </div>
        </form>
      </Card>
      <Card
        title="登录会话"
        desc={sessions === null ? "加载中…" : `当前共有 ${sessions} 个有效登录（含本设备）。`}
        actions={
          <button
            className="btn btn-ghost btn-sm"
            disabled={!sessions || sessions <= 1}
            onClick={async () => {
              await api.revokeOtherSessions();
              loadSessions();
            }}
          >
            退出其他设备
          </button>
        }
      />
    </div>
  );
}

// ---------- API Token ----------

const ALL_SCOPES: Scope[] = ["memos:read", "memos:write", "export", "insights:read"];
const EXPIRY_OPTIONS = [
  { label: "永不过期", days: null },
  { label: "30 天", days: 30 },
  { label: "90 天", days: 90 },
  { label: "1 年", days: 365 },
];

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "已复制" : label}
    </button>
  );
}

function CodeLine({ code }: { code: string }) {
  return (
    <div className="code-line">
      <code>{code}</code>
      <CopyButton text={code} />
    </div>
  );
}

function TokensSection() {
  const [list, setList] = useState<ApiToken[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const origin = location.origin;

  const load = () => api.listTokens().then((r) => setList(r.tokens));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="settings-stack">
      {created && (
        <div className="notice-ok">
          <div>
            <b>Token「{created.name}」已创建。</b>请现在复制保存，关闭后将无法再次查看。
          </div>
          <div className="code-line">
            <code>{created.token}</code>
            <CopyButton text={created.token} />
          </div>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>我已保存</button>
          </div>
        </div>
      )}

      <Card
        title="API Token"
        desc="用于 MCP、CLI 或脚本访问你的笔记。Token 只在创建时显示一次。"
        actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>新建 Token</button>}
      >
        {list === null ? (
          <div className="muted small">加载中…</div>
        ) : list.length === 0 ? (
          <div className="muted small">还没有 Token。</div>
        ) : (
          <div className="token-list">
            {list.map((t) => {
              const expired = t.expiresAt !== null && t.expiresAt < Date.now();
              return (
                <div key={t.id} className="token-row">
                  <div className="token-main">
                    <div className="token-name">
                      {t.name} <span className="mono muted small">{t.prefix}…</span>
                      {expired && <span className="badge danger-badge">已过期</span>}
                    </div>
                    <div className="token-scopes">
                      {t.scopes.map((s) => (
                        <span key={s} className="scope-chip">{SCOPE_LABEL[s] ?? s}</span>
                      ))}
                    </div>
                    <div className="muted small">
                      最近使用：{relative(t.lastUsedAt)} · 过期：{formatDate(t.expiresAt, "永不")} · 创建于 {formatDate(t.createdAt)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm danger-text"
                    onClick={async () => {
                      if (!window.confirm(`撤销「${t.name}」？使用它的工具会立即失去访问权限。`)) return;
                      await api.revokeToken(t.id);
                      load();
                    }}
                  >
                    撤销
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="MCP 接入" desc="在 Claude Code 等支持 MCP 的工具里搜索和新增 memo。先新建一个 Token，然后执行：">
        <CodeLine code={`claude mcp add --transport http yaf ${origin}/mcp --header "Authorization: Bearer <你的 Token>"`} />
        <p className="muted small">可用工具：search_memos、get_memo、add_memo、get_related、list_tags、list_insights。</p>
      </Card>

      <Card title="CLI" desc="在终端里记录和搜索。登录时会打开浏览器确认，无需手动复制 Token。">
        <CodeLine code="npm install -g yaf-cli" />
        <CodeLine code={`yaf login --host ${origin}`} />
        <CodeLine code={`echo "想法 #inbox" | yaf add`} />
        <p className="muted small">其他命令：yaf search &lt;关键词&gt;、yaf tags、yaf export --tag &lt;标签&gt;。</p>
      </Card>

      {creating && (
        <CreateTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(token, name) => {
            setCreating(false);
            setCreated({ token, name });
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateTokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (token: string, name: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["memos:read", "memos:write"]);
  const [days, setDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!scopes.length) return setError("至少选择一项权限");
    setBusy(true);
    try {
      const r = await api.createToken({ name, scopes, expiresInDays: days });
      onCreated(r.token, r.info.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>新建 API Token</h2>
        <label>
          <span>名称</span>
          <input required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Claude Code" />
        </label>
        <div className="field">
          <span className="field-label">权限</span>
          <div className="check-list">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="check">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))}
                />
                <span>{SCOPE_LABEL[s]}</span>
                <span className="mono muted small">{s}</span>
              </label>
            ))}
          </div>
        </div>
        <label>
          <span>过期时间</span>
          <select value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.days ?? ""}>{o.label}</option>
            ))}
          </select>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "创建中…" : "创建"}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- 洞察与搜索 ----------

function InsightsSearchSection() {
  return (
    <div className="settings-stack">
      <PlansCard />
      <ModelCard />
      <SearchIndexCard />
    </div>
  );
}

const CADENCE_LABEL: Record<Cadence, string> = { daily: "每天", weekly: "每周", monthly: "每月", custom: "自定义 cron" };
const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  balanced: "综合",
  patterns: "模式与习惯",
  actions: "行动与计划",
  questions: "提问与反思",
};
const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function PlansCard() {
  const [plans, setPlans] = useState<InsightPlan[] | null>(null);
  const [editing, setEditing] = useState<InsightPlan | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.listPlans().then((r) => setPlans(r.plans));
  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="洞察计划"
      desc="按频率自动回顾一段时间内的 memo，生成的报告在「洞察」页查看。"
      actions={<button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>新建计划</button>}
    >
      {msg && <div className="form-ok">{msg}</div>}
      {plans === null ? (
        <div className="muted small">加载中…</div>
      ) : plans.length === 0 ? (
        <div className="muted small">还没有计划。建议先建一个「每周回顾」。</div>
      ) : (
        <div className="token-list">
          {plans.map((p) => (
            <div key={p.id} className="token-row">
              <div className="token-main">
                <div className="token-name">
                  <span className={"dot " + (p.enabled ? "dot-ok" : "dot-off")} />
                  {p.name}
                  {!p.enabled && <span className="badge">已停用</span>}
                </div>
                <div className="muted small">
                  {describeSchedule(p)} · 最近 {p.windowDays} 天 · {PERSPECTIVE_LABEL[p.perspective]} ·{" "}
                  {p.model === "claude" ? "Claude" : "Workers AI"}
                  {p.scopeTags.length > 0 && <> · {p.scopeTags.map((t) => "#" + t).join(" ")}</>}
                </div>
                {p.enabled && p.nextRunAt && <div className="muted small">下次生成：{formatDate(p.nextRunAt)}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>编辑</button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <PlanEditor
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMsg(text);
            load();
          }}
        />
      )}
    </Card>
  );
}

function PlanEditor({ plan, onClose, onSaved }: { plan: InsightPlan | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState<PlanInput>(() =>
    plan
      ? { ...plan }
      : {
          name: "每周回顾",
          cadence: "weekly",
          time: "21:00",
          weekday: 0,
          monthday: 1,
          cron: "0 21 * * 0",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
          scopeTags: [],
          windowDays: 7,
          perspective: "balanced",
          extraPrompt: "",
          model: "workers-ai",
          enabled: true,
        },
  );
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | "delete" | null>(null);
  const [hasClaudeKey, setHasClaudeKey] = useState(false);

  useEffect(() => {
    api.tags().then((r) => setTags(r.tags));
    api.aiSettings().then((r) => setHasClaudeKey(r.hasClaudeKey));
  }, []);

  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const allTags = [...new Set(tags.flatMap(({ tag }) => tag.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))))].sort();

  async function save(run: boolean) {
    setError(null);
    setBusy(run ? "run" : "save");
    try {
      const body: PlanInput = { ...form, time: form.time ?? "21:00" };
      const { plan: saved } = plan ? await api.updatePlan(plan.id, body) : await api.createPlan(body);
      if (run) {
        const r = await api.runPlan(saved.id);
        navigate(`/insights/${r.id}`);
        return;
      }
      onSaved(`已保存「${saved.name}」`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function remove() {
    if (!plan || !window.confirm(`删除计划「${plan.name}」？已生成的报告会保留。`)) return;
    setBusy("delete");
    await api.deletePlan(plan.id);
    onSaved(`已删除「${plan.name}」`);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog dialog-wide"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <h2>{plan ? "编辑洞察计划" : "新建洞察计划"}</h2>
        <div className="form-row">
          <label className="grow">
            <span>名称</span>
            <input required maxLength={40} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="check check-inline">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            <span>启用</span>
          </label>
        </div>

        <div className="field">
          <span className="field-label">频率</span>
          <div className="segmented">
            {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
              <button
                type="button"
                key={c}
                className={form.cadence === c ? "on" : ""}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    cadence: c,
                    windowDays: !plan && c !== f.cadence ? { daily: 1, weekly: 7, monthly: 30, custom: f.windowDays ?? 7 }[c] : f.windowDays,
                  }))
                }
              >
                {CADENCE_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          {form.cadence === "custom" ? (
            <label className="grow">
              <span>cron 表达式（分 时 日 月 周）</span>
              <input className="mono" required value={form.cron ?? ""} onChange={(e) => set("cron", e.target.value)} placeholder="0 21 * * 0" />
            </label>
          ) : (
            <>
              {form.cadence === "weekly" && (
                <label>
                  <span>星期</span>
                  <select value={form.weekday ?? 0} onChange={(e) => set("weekday", Number(e.target.value))}>
                    {WEEKDAY_NAMES.map((n, i) => (
                      <option key={i} value={i}>{n}</option>
                    ))}
                  </select>
                </label>
              )}
              {form.cadence === "monthly" && (
                <label>
                  <span>日期</span>
                  <select value={form.monthday ?? 1} onChange={(e) => set("monthday", Number(e.target.value))}>
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i} value={i + 1}>{i + 1} 号</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>时间</span>
                <input type="time" required value={form.time ?? "21:00"} onChange={(e) => set("time", e.target.value)} />
              </label>
            </>
          )}
          <label>
            <span>时区</span>
            <input value={form.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} />
          </label>
        </div>

        <div className="form-row">
          <label>
            <span>分析窗口（天）</span>
            <input type="number" min={1} max={365} required value={form.windowDays ?? 7} onChange={(e) => set("windowDays", Number(e.target.value))} />
          </label>
          <label className="grow">
            <span>分析视角</span>
            <select value={form.perspective} onChange={(e) => set("perspective", e.target.value as Perspective)}>
              {(Object.keys(PERSPECTIVE_LABEL) as Perspective[]).map((p) => (
                <option key={p} value={p}>{PERSPECTIVE_LABEL[p]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field-label">范围（不选 = 全部 memo；选父标签会包含子标签）</span>
          <div className="tag-picker">
            {(form.scopeTags ?? []).map((t) => (
              <span key={t} className="scope-chip">
                #{t}
                <button type="button" onClick={() => set("scopeTags", (form.scopeTags ?? []).filter((x) => x !== t))}>×</button>
              </span>
            ))}
            <select
              value={tagInput}
              onChange={(e) => {
                const t = e.target.value;
                setTagInput("");
                if (t && !(form.scopeTags ?? []).includes(t)) set("scopeTags", [...(form.scopeTags ?? []), t]);
              }}
            >
              <option value="">＋ 添加标签</option>
              {allTags.map((t) => (
                <option key={t} value={t}>#{t}</option>
              ))}
            </select>
          </div>
        </div>

        <label>
          <span>补充提示词（可选）</span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={1000}
            value={form.extraPrompt ?? ""}
            onChange={(e) => set("extraPrompt", e.target.value)}
            placeholder="例如：多关注和工作效率有关的内容"
          />
        </label>

        <div className="form-row">
          <label className="grow">
            <span>模型</span>
            <select value={form.model} onChange={(e) => set("model", e.target.value as "workers-ai" | "claude")}>
              <option value="workers-ai">Workers AI（免费）</option>
              <option value="claude" disabled={!hasClaudeKey}>Claude（自带 API key）{hasClaudeKey ? "" : " · 未设置 key"}</option>
            </select>
          </label>
          <label className="grow">
            <span>投递方式</span>
            <select value="inapp" disabled>
              <option value="inapp">站内（洞察页）</option>
            </select>
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          {plan && (
            <button type="button" className="btn btn-ghost danger-text" disabled={!!busy} onClick={remove}>删除</button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => save(true)} title="保存并立即生成一份报告">
            {busy === "run" ? "启动中…" : "保存并试运行"}
          </button>
          <button className="btn btn-primary" disabled={!!busy}>{busy === "save" ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </div>
  );
}

function ModelCard() {
  const [info, setInfo] = useState<{ hasClaudeKey: boolean; workersAiModel: string; claudeModel: string } | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.aiSettings().then(setInfo);
  }, []);

  async function saveKey(value: string | null) {
    setError(null);
    setBusy(true);
    try {
      const r = await api.setClaudeKey(value);
      setInfo((i) => i && { ...i, hasClaudeKey: r.hasClaudeKey });
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="洞察模型" desc="默认用 Workers AI（免费额度内不收费）。也可以填自己的 Claude API key，在计划里选择 Claude，质量更高。">
      {info && (
        <div className="kv">
          <span className="muted">Workers AI</span>
          <span className="mono small">{info.workersAiModel}</span>
          <span className="muted">Claude</span>
          <span>
            <span className="mono small">{info.claudeModel}</span> · {info.hasClaudeKey ? "已设置 key" : "未设置 key"}
          </span>
        </div>
      )}
      <form
        className="form-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) saveKey(key.trim());
        }}
      >
        <label className="grow">
          <span>Claude API key（加密保存，不会再显示）</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
        </label>
        <button className="btn btn-primary btn-sm form-row-btn" disabled={busy || !key.trim()}>保存</button>
        {info?.hasClaudeKey && (
          <button type="button" className="btn btn-ghost btn-sm form-row-btn danger-text" disabled={busy} onClick={() => saveKey(null)}>
            删除 key
          </button>
        )}
      </form>
      {error && <div className="form-error">{error}</div>}
    </Card>
  );
}

function SearchIndexCard() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .searchStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    load();
  }, []);

  // 任务运行中每 2 秒刷新一次进度
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [status?.running]);

  async function start(full: boolean) {
    if (full && !window.confirm("重建会重新计算全部 memo 的向量，期间语义搜索结果可能不完整。继续？")) return;
    setError(null);
    try {
      setStatus(await api.reindex(full));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pct = status && status.total ? Math.round((status.indexed / status.total) * 100) : 100;
  const synced = status && status.indexed >= status.total;

  return (
    <Card
      title="语义搜索索引"
      desc="每条 memo 会生成一个向量，用于语义搜索和相关笔记。新写入的 memo 会在后台自动建立索引。"
      actions={
        <div className="card-actions">
          {status && !synced && !status.running && (
            <button className="btn btn-ghost btn-sm" onClick={() => start(false)}>补全索引</button>
          )}
          <button className="btn btn-ghost btn-sm" disabled={!status || status.running} onClick={() => start(true)}>
            重建索引
          </button>
        </div>
      }
    >
      {status ? (
        <>
          <div className="index-status">
            <span className={"dot " + (status.running ? "dot-busy" : synced ? "dot-ok" : "dot-warn")} />
            {status.running ? "正在建立索引…" : synced ? "已同步" : "有未索引的 memo"}
            <span className="muted">
              {status.indexed} / {status.total}
            </span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="kv">
            <span className="muted">向量模型</span>
            <span className="mono small">{status.model}</span>
            <span className="muted">融合方式</span>
            <span>RRF（按关键词和语义两路结果的名次融合）</span>
            {status.jobStartedAt && (
              <>
                <span className="muted">上次任务</span>
                <span>
                  {formatDate(status.jobStartedAt)} · {JOB_STATUS[status.jobStatus ?? ""] ?? status.jobStatus}
                </span>
              </>
            )}
          </div>
        </>
      ) : (
        !error && <div className="muted small">加载中…</div>
      )}
      {error && <div className="form-error">{error}</div>}
    </Card>
  );
}

const JOB_STATUS: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  waiting: "等待中",
  complete: "已完成",
  errored: "失败",
  terminated: "已终止",
  unknown: "未知",
};
