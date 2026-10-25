import { useEffect, useMemo, useRef, useState } from "react";
import type { Memo } from "../api";
import { renderMarkdown } from "../markdown";
import { Editor } from "./Editor";

interface Props {
  memo: Memo;
  onUpdate: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const SOURCE_LABEL: Record<string, string> = { wechat: "来自微信", api: "来自 API", cli: "来自 CLI", mcp: "来自 MCP" };

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function MemoCard({ memo, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(memo.content), [memo.content]);

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
    </article>
  );
}
