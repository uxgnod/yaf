import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type AiUsage, type LensCount, type Stats, type TagCount, type User } from "../api";
import { navigate } from "../router";

interface TagNode {
  name: string;
  path: string;
  count: number;
  children: TagNode[];
}

function buildTree(tags: TagCount[]): TagNode[] {
  const root: TagNode = { name: "", path: "", count: 0, children: [] };
  for (const { tag, count } of tags) {
    let node = root;
    const parts = tag.split("/");
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, count: 0, children: [] };
        node.children.push(child);
      }
      if (i === parts.length - 1) child.count += count;
      node = child;
    });
  }
  return root.children;
}

function TagItem({ node, active, onSelect, depth }: { node: TagNode; active: string | null | undefined; onSelect: (t: string) => void; depth: number }) {
  const hasChildren = node.children.length > 0;
  const containsActive = !!active && active.startsWith(node.path + "/");
  const [open, setOpen] = useState(containsActive);
  // 选中的是子标签时自动展开
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  return (
    <li>
      <div
        className={"nav-item tag-item" + (active === node.path ? " active" : "")}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.path)}
      >
        <span
          className={"caret" + (hasChildren ? "" : " hidden") + (open ? " open" : "")}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          ▸
        </span>
        <span className="hash">#</span>
        <span className="tag-name">{node.name}</span>
        {node.count > 0 && <span className="count">{node.count}</span>}
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((c) => (
            <TagItem key={c.path} node={c} active={active} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

const WEEKS = 16;

function Heatmap({ data }: { data: Stats["heatmap"] }) {
  const cells = useMemo(() => {
    const map = new Map(data.map((d) => [d.day, d.count]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 以周为列，最后一列结束于本周六
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const out: { day: string; count: number; future: boolean }[] = [];
    for (let i = WEEKS * 7 - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ day: key, count: map.get(key) ?? 0, future: d > today });
    }
    return out;
  }, [data]);

  const level = (n: number) => (n === 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 7 ? 3 : 4);
  return (
    <div className="heatmap">
      {cells.map((c) => (
        <span
          key={c.day}
          className={`cell l${level(c.count)}${c.future ? " future" : ""}`}
          title={`${c.day} · ${c.count} 条`}
        />
      ))}
    </div>
  );
}

const LENS_ICON: Record<string, string> = { todo: "☑", private: "⚿" };

type Popover = "menu" | "usage" | null;

/** 底部一行：账户菜单 + 用量圆环。两个弹层都点击打开、互斥，点外面或 Esc 关闭 */
function SidebarBottom(props: Props) {
  const [pop, setPop] = useState<Popover>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rowRef.current?.contains(t) && !cardRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [pop]);
  const toggle = (p: Popover) => () => setPop((v) => (v === p ? null : p));
  return (
    <div className="sidebar-bottom" ref={rowRef}>
      <AccountMenu {...props} open={pop === "menu"} onToggle={toggle("menu")} onClose={() => setPop(null)} />
      {props.user.role === "admin" && <UsageRing open={pop === "usage"} onToggle={toggle("usage")} rowRef={rowRef} cardRef={cardRef} />}
    </div>
  );
}

const THEME_LABEL: Record<string, string> = { system: "跟随系统", light: "亮色", dark: "暗色" };

/** 账户菜单：主题、设置、导出，分隔线下是退出登录 */
function AccountMenu({
  user, onExport, onLogout, theme, onToggleTheme, open, onToggle, onClose,
}: Pick<Props, "user" | "onExport" | "onLogout" | "theme" | "onToggleTheme"> & { open: boolean; onToggle: () => void; onClose: () => void }) {
  const pick = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div className="account">
      {open && (
        <div className="menu account-menu" role="menu">
          <button role="menuitem" onClick={onToggleTheme}>
            主题<span className="menu-value">{THEME_LABEL[theme] ?? theme}</span>
          </button>
          <button role="menuitem" onClick={pick(() => navigate("/settings/account"))}>设置</button>
          <button role="menuitem" onClick={pick(onExport)}>导出</button>
          <div className="menu-sep" />
          <button role="menuitem" onClick={pick(onLogout)}>退出登录</button>
        </div>
      )}
      <button className={"account-btn" + (open ? " open" : "")} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <span className="avatar">{(user.name || user.email)[0].toUpperCase()}</span>
        <span className="user-name" title={user.email}>{user.name || user.email}</span>
        <svg className="account-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

const USAGE_REFRESH = 5 * 60_000;
const nf = new Intl.NumberFormat();
/** 构成条按用量从大到小，同一色相由深到浅 */
const SHADES = [
  "var(--accent)",
  "color-mix(in srgb, var(--accent) 62%, var(--surface))",
  "color-mix(in srgb, var(--accent) 38%, var(--surface))",
  "color-mix(in srgb, var(--accent) 22%, var(--surface))",
  "var(--border-strong)",
];

function ago(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  return `${Math.round(min / 60)} 小时前`;
}

/** 底部右侧：今日 Workers AI neurons 用量圆环，点击展开明细（只给 admin）。
 *  卡片挂到 body 上用 fixed 定位，左边对齐底部这一行，避免被侧栏的滚动容器裁掉 */
function UsageRing({ open, onToggle, rowRef, cardRef }: {
  open: boolean;
  onToggle: () => void;
  rowRef: React.RefObject<HTMLDivElement | null>;
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0, origin: "100% 100%" });
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const load = () => api.aiUsage().then((r) => setUsage(r.usage), () => {});
    load();
    const t = setInterval(load, USAGE_REFRESH);
    return () => clearInterval(t);
  }, []);
  useLayoutEffect(() => {
    if (!open || !rowRef.current || !btnRef.current) return;
    const row = rowRef.current.getBoundingClientRect();
    const btn = btnRef.current.getBoundingClientRect();
    setPos({ left: row.left, bottom: window.innerHeight - row.top + 8, origin: `${btn.left + btn.width / 2 - row.left}px 100%` });
  }, [open, rowRef]);
  if (!usage) return null;
  const ratio = usage.total / usage.limit;
  const pct = Math.round(ratio * 100);
  const high = ratio >= 0.8;
  const r = 7;
  const len = 2 * Math.PI * r;
  const now = Date.now();
  const hours = Math.max(1, Math.ceil((usage.resetAt - now) / 3_600_000));
  const parts = usage.parts.filter((p) => p.neurons > 0).sort((a, b) => b.neurons - a.neurons);
  const share = (n: number) => {
    const v = (n / usage.total) * 100;
    return v < 1 ? "<1%" : `${Math.round(v)}%`;
  };
  return (
    <>
      <button
        ref={btnRef}
        className={"usage" + (high ? " high" : "") + (open ? " open" : "")}
        title={`AI 用量 ${pct}%`}
        aria-label={`今日 AI 用量 ${pct}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg className="usage-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r={r} className="track" />
          <circle cx="9" cy="9" r={r} className="fill" strokeDasharray={`${Math.min(ratio, 1) * len} ${len}`} transform="rotate(-90 9 9)" />
        </svg>
      </button>
      {createPortal(
        <div
          ref={cardRef}
          className={"usage-card" + (open ? " open" : "") + (high ? " high" : "")}
          role="dialog"
          aria-label="今日 AI 用量"
          aria-hidden={!open}
          style={{ left: pos.left, bottom: pos.bottom, transformOrigin: pos.origin }}
        >
          <div className="usage-head usage-in">
            <b>今日 AI 用量</b>
            <span className="num">{nf.format(usage.total)} / {nf.format(usage.limit)}（{pct}%）</span>
          </div>
          {parts.length > 0 && (
            <>
              <div className="usage-bar usage-in d1">
                {parts.map((p, i) => (
                  <span key={p.key} style={{ flexGrow: p.neurons, background: SHADES[Math.min(i, SHADES.length - 1)] }} />
                ))}
              </div>
              <ul className="usage-legend usage-in d2">
                {parts.map((p, i) => (
                  <li key={p.key} title={`${nf.format(p.neurons)} neurons`}>
                    <span className="dot" style={{ background: SHADES[Math.min(i, SHADES.length - 1)] }} />
                    {p.label}
                    <span className="num">{share(p.neurons)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="usage-foot usage-in d3">
            <div>{usage.plan === "paid" ? "Paid" : "Free"} 套餐<span className="num">{hours} 小时后重置</span></div>
            <div>账户合计<span className="num">{ago(now - usage.updatedAt)}</span></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

interface Props {
  user: User;
  stats: Stats | null;
  tags: TagCount[];
  lenses: LensCount[];
  /** undefined：当前不在笔记列表页，任何标签都不高亮 */
  activeTag: string | null | undefined;
  activeLens: string | null;
  onSelectLens: (lens: string) => void;
  view: "memos" | "insights";
  unreadInsights: number;
  onSelectTag: (tag: string | null) => void;
  onExport: () => void;
  onLogout: () => void;
  theme: string;
  onToggleTheme: () => void;
}

export function Sidebar(props: Props) {
  const { stats, tags, lenses, activeTag, activeLens, onSelectLens, view, unreadInsights, onSelectTag } = props;
  const tree = useMemo(() => buildTree(tags), [tags]);
  return (
    <aside className="sidebar">
      {stats && (
        <>
          <div className="stats">
            <div><b>{stats.totals.memos}</b><span>笔记</span></div>
            <div><b>{stats.totals.tags}</b><span>标签</span></div>
            <div><b>{stats.totals.days}</b><span>天</span></div>
          </div>
          <Heatmap data={stats.heatmap} />
        </>
      )}

      <nav className="nav">
        <div className={"nav-item" + (activeTag === null && !activeLens ? " active" : "")} onClick={() => onSelectTag(null)}>
          <span className="nav-icon">▤</span> 全部笔记
        </div>
        <div className={"nav-item" + (view === "insights" ? " active" : "")} onClick={() => navigate("/insights")}>
          <span className="nav-icon">✦</span> 洞察
          {unreadInsights > 0 && <span className="new-badge">{unreadInsights} 新</span>}
        </div>
      </nav>

      {lenses.length > 0 && (
        <>
          <div className="section-title">视图</div>
          <nav className="nav" aria-label="视图">
            {lenses.map((l) => (
              <div key={l.key} className={"nav-item" + (activeLens === l.key ? " active" : "")} onClick={() => onSelectLens(l.key)}>
                <span className="nav-icon">{LENS_ICON[l.key] ?? "◇"}</span> {l.name}
                {l.count > 0 && <span className="count">{l.count}</span>}
              </div>
            ))}
          </nav>
        </>
      )}

      <div className="section-title">全部标签</div>
      <ul className="tag-tree">
        {tree.length === 0 && <li className="muted small empty-tags">在内容中输入 #标签 即可创建</li>}
        {tree.map((n) => (
          <TagItem key={n.path} node={n} active={activeTag} onSelect={onSelectTag} depth={0} />
        ))}
      </ul>

      <SidebarBottom {...props} />
    </aside>
  );
}
