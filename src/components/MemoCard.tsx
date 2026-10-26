import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Attachment, type Memo, type MemoHit } from "../api";
import { renderMarkdown } from "../markdown";
import { silkToWavUrl } from "../silk";
import { Editor } from "./Editor";
import { SourceIcon } from "./SourceIcon";

interface Props {
  memo: MemoHit;
  /** 搜索词，用于高亮 */
  terms?: string[];
  onUpdate: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

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
          allowEmpty={Boolean(memo.attachments?.length)}
          submitLabel="保存"
          autoFocus
          closeOnOutsideClick
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
          <SourceIcon source={memo.source} />
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
      {memo.content.trim() && (
        <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} onDoubleClick={() => setEditing(true)} />
      )}
      {memo.attachments && memo.attachments.length > 0 && <Attachments list={memo.attachments} />}
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

function duration(ms: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}′${String(s % 60).padStart(2, "0")}″` : `${s}″`;
}

function Attachments({ list }: { list: Attachment[] }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const images = list.filter((a) => a.kind === "image");
  const voices = list.filter((a) => a.kind === "voice");
  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className={"att-images" + (images.length === 1 ? " single" : "")}>
          {images.map((a) =>
            a.hasFile ? (
              // AI 描述只用于无障碍朗读、悬停提示和搜索，不在卡片上显示
              <button key={a.id} className="att-thumb" onClick={() => setZoom(a.id)} aria-label={`查看大图${a.description ? "：" + a.description : ""}`}>
                <img src={api.attachmentUrl(a.id)} alt={a.description ?? "图片"} title={a.description ?? undefined} loading="lazy" />
              </button>
            ) : (
              <span key={a.id} className="att-missing muted small" title={a.description ?? undefined}>图片原文件未保存</span>
            ),
          )}
        </div>
      )}
      {voices.map((a) =>
        a.hasFile ? (
          <div key={a.id} className="att-voice">
            <VoicePlayer id={a.id} durationMs={a.durationMs} />
            {!a.description && <span className="muted small">没有转写文字</span>}
          </div>
        ) : (
          <span key={a.id} className="att-missing muted small">语音原文件未保存</span>
        ),
      )}
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={api.attachmentUrl(zoom)} alt={images.find((a) => a.id === zoom)?.description ?? ""} />
        </div>
      )}
    </div>
  );
}

/** 点击后才下载并解码 SILK，解码完成后用原生播放器播放 */
function VoicePlayer({ id, durationMs }: { id: string; durationMs: number | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  if (src) return <audio controls autoPlay src={src} />;
  const label = duration(durationMs);
  return (
    <button
      className="att-voice-play"
      disabled={state === "loading"}
      aria-label={`播放语音${label ? "，" + label : ""}`}
      onClick={async () => {
        setState("loading");
        try {
          setSrc(await silkToWavUrl(api.attachmentUrl(id)));
        } catch (e) {
          console.error(e);
          setState("error");
        }
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 1l7 4-7 4z" fill="currentColor" />
      </svg>
      <span className="att-voice-wave" aria-hidden="true" />
      <span className="att-voice-time">
        {state === "error" ? "解码失败" : state === "loading" ? "加载中" : label || "播放"}
      </span>
    </button>
  );
}
