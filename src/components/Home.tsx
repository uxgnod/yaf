import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Memo, type Stats, type TagCount, type User } from "../api";
import { Editor } from "./Editor";
import { MemoCard } from "./MemoCard";
import { Sidebar } from "./Sidebar";
import { ExportDialog } from "./ExportDialog";
import { useTheme } from "../theme";
import { navigate } from "../router";

/** 当前标签筛选保存在 URL hash（#tag=xxx），这样 memo 内的标签链接可以直接跳转 */
function readTagFromHash(): string | null {
  const m = location.hash.match(/^#tag=(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function Home({ user, view, onLogout }: { user: User; view: "memos" | "insights"; onLogout: () => void }) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState<string | null>(readTagFromHash);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tags, setTags] = useState<TagCount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const reqId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onHash = () => setTag(readTagFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const refreshMeta = useCallback(() => {
    api.tags().then((r) => setTags(r.tags));
    api.stats().then(setStats);
  }, []);

  const load = useCallback(
    async (reset: boolean, from: string | null) => {
      const id = ++reqId.current;
      setLoading(true);
      try {
        const r = await api.listMemos({ q: debounced, tag: tag ?? undefined, cursor: reset ? null : from });
        if (id !== reqId.current) return;
        setMemos((prev) => (reset ? r.memos : [...prev, ...r.memos]));
        setCursor(r.nextCursor);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [debounced, tag],
  );

  useEffect(() => {
    load(true, null);
  }, [load]);

  useEffect(refreshMeta, [refreshMeta]);

  // 无限滚动
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading) load(false, cursor);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, load]);

  function selectTag(t: string | null) {
    setSidebarOpen(false);
    if (view !== "memos") navigate("/");
    if (t) location.hash = `tag=${encodeURIComponent(t)}`;
    else history.replaceState(null, "", location.pathname + location.search);
    setTag(t);
  }

  async function create(content: string) {
    const { memo } = await api.createMemo(content);
    // 新 memo 若不符合当前筛选，则重新加载；否则直接插入顶部
    if (debounced || tag) load(true, null);
    else setMemos((prev) => [memo, ...prev]);
    refreshMeta();
  }

  async function update(id: string, content: string) {
    const { memo } = await api.updateMemo(id, content);
    setMemos((prev) => prev.map((m) => (m.id === id ? memo : m)));
    refreshMeta();
  }

  async function remove(id: string) {
    await api.deleteMemo(id);
    setMemos((prev) => prev.filter((m) => m.id !== id));
    refreshMeta();
  }

  return (
    <div className={"layout" + (sidebarOpen ? " sidebar-open" : "")}>
      <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
      <Sidebar
        user={user}
        stats={stats}
        tags={tags}
        activeTag={view === "memos" ? tag : undefined}
        view={view}
        onSelectTag={selectTag}
        onExport={() => setExporting(true)}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={toggle}
      />
      <main className="main">
        {view === "insights" ? (
          <>
            <div className="topbar">
              <button className="icon-btn menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="菜单">☰</button>
              <div className="title">洞察</div>
            </div>
            <div className="placeholder-card">
              <div className="placeholder-icon">✦</div>
              <h3>洞察即将上线</h3>
              <p className="muted">按你设定的频率回顾笔记，找出反复出现的主题、新的连接和值得追问的问题。</p>
            </div>
          </>
        ) : (
          <>
            <div className="topbar">
              <button className="icon-btn menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="菜单">☰</button>
              <div className="title">
                {tag ? (
                  <>
                    <span className="hash">#</span>
                    {tag}
                    <button className="chip-clear" onClick={() => selectTag(null)} title="清除筛选">×</button>
                  </>
                ) : (
                  "全部笔记"
                )}
              </div>
              <div className="search">
                <span className="search-icon">⌕</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 memo…" />
                {query && <button className="chip-clear" onClick={() => setQuery("")}>×</button>}
              </div>
            </div>

            <Editor key={tag ?? ""} initial={tag ? `#${tag} ` : ""} onSubmit={create} />

            <div className="memo-list">
              {memos.map((m) => (
                <MemoCard key={m.id} memo={m} onUpdate={update} onDelete={remove} />
              ))}
              {!loading && memos.length === 0 && (
                <div className="empty muted">{debounced || tag ? "没有匹配的 memo" : "还没有 memo，写下第一条吧"}</div>
              )}
              <div ref={sentinel} />
              {loading && <div className="empty muted small">加载中…</div>}
            </div>
          </>
        )}
      </main>
      {exporting && <ExportDialog tags={tags} defaultTag={tag} onClose={() => setExporting(false)} />}
    </div>
  );
}
