import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Memo, type MemoHit } from "../api";
import { renderMarkdown } from "../markdown";
import { Editor } from "./Editor";

interface Props {
  memo: MemoHit;
  /** 搜索词，用于高亮 */
  terms?: string[];
  onUpdate: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const SOURCE_LABEL: Record<string, string> = { wechat: "来自微信", api: "来自 API", cli: "来自 CLI", mcp: "来自 MCP" };

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function MemoCard({ memo, terms = [], onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(memo.content, terms), [memo.content, terms]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (editing) {
    return (
      <div className="memo-card editing">
        <Editor
          initial={memo.content}
          submitLabel="保存"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (content) => {
            await onUpdate(memo.id, content);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <article className="memo-card">
      <header className="memo-head">
        <div className="memo-meta">
          <time title={memo.updatedAt !== memo.createdAt ? `编辑于 ${formatTime(memo.updatedAt)}` : undefined}>
            {formatTime(memo.createdAt)}
          </time>
          {SOURCE_LABEL[memo.source] && <span className={`source-badge source-${memo.source}`}>{SOURCE_LABEL[memo.source]}</span>}
          {memo.match?.keywordRank && <span className="hit-badge hit-keyword">关键词</span>}
          {memo.match?.semanticScore && (
            <span className="hit-badge hit-semantic" title="语义相似度（cosine）">语义 {memo.match.semanticScore.toFixed(2)}</span>
          )}
        </div>
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenu((v) => !v)} aria-label="更多">
            ···
          </button>
          {menu && (
            <div className="menu">
              <button
                onClick={() => {
                  setMenu(false);
                  setEditing(true);
                }}
              >
                编辑
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  navigator.clipboard.writeText(memo.content);
                }}
              >
                复制 Markdown
              </button>
              <button
                className="danger"
                onClick={async () => {
                  setMenu(false);
                  if (window.confirm("确定删除这条 memo？")) await onDelete(memo.id);
                }}
              >
                删除
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} onDoubleClick={() => setEditing(true)} />
      <Related memoId={memo.id} />
    </article>
  );
}

/** 「相关笔记」：默认收起，点开时才查询，避免每张卡片都调用一次向量检索 */
function Related({ memoId }: { memoId: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<(Memo & { score: number })[] | null>(null);
  const [error, setError] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && list === null) {
      try {
        setList((await api.related(memoId)).memos);
      } catch {
        setError(true);
      }
    }
  }

  return (
    <div className="related">
      <button className="related-toggle" onClick={toggle}>
        <span className={"caret" + (open ? " open" : "")}>▸</span> 相关笔记{list ? ` · ${list.length}` : ""}
      </button>
      {open && (
        <div className="related-list">
          {error ? (
            <div className="muted small">加载失败</div>
          ) : list === null ? (
            <div className="muted small">查找中…</div>
          ) : list.length === 0 ? (
            <div className="muted small">没有找到相关的笔记（新写的 memo 需要几秒钟建立索引）</div>
          ) : (
            list.map((m) => (
              <div key={m.id} className="related-item">
                <div className="related-meta muted small">
                  {formatTime(m.createdAt).slice(0, 10)} · 相似度 {m.score.toFixed(2)}
                </div>
                <div className="related-text">{m.content.length > 140 ? m.content.slice(0, 140) + "…" : m.content}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
