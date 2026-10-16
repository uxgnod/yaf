import { useEffect, useMemo, useState } from "react";
import type { Stats, TagCount, User } from "../api";

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

function TagItem({ node, active, onSelect, depth }: { node: TagNode; active: string | null; onSelect: (t: string) => void; depth: number }) {
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

interface Props {
  user: User;
  stats: Stats | null;
  tags: TagCount[];
  activeTag: string | null;
  onSelectTag: (tag: string | null) => void;
  onExport: () => void;
  onLogout: () => void;
  theme: string;
  onToggleTheme: () => void;
}

export function Sidebar({ user, stats, tags, activeTag, onSelectTag, onExport, onLogout, theme, onToggleTheme }: Props) {
  const tree = useMemo(() => buildTree(tags), [tags]);
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="user">
          <span className="avatar">{(user.name || user.email)[0].toUpperCase()}</span>
          <span className="user-name" title={user.email}>{user.name || user.email}</span>
          {user.role === "admin" && <span className="badge">admin</span>}
        </div>
        <button className="icon-btn" onClick={onToggleTheme} title={`主题：${theme}`}>
          {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
        </button>
      </div>

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
        <div className={"nav-item" + (activeTag === null ? " active" : "")} onClick={() => onSelectTag(null)}>
          <span className="nav-icon">▤</span> 全部笔记
        </div>
        <div className="nav-item" onClick={onExport}>
          <span className="nav-icon">⤓</span> 导出
        </div>
      </nav>

      <div className="section-title">全部标签</div>
      <ul className="tag-tree">
        {tree.length === 0 && <li className="muted small empty-tags">在内容中输入 #标签 即可创建</li>}
        {tree.map((n) => (
          <TagItem key={n.path} node={n} active={activeTag} onSelect={onSelectTag} depth={0} />
        ))}
      </ul>

      <div className="sidebar-bottom">
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>退出登录</button>
      </div>
    </aside>
  );
}
