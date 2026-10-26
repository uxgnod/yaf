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
  /** 用户手动改视图标记 */
  onLabel: (id: string, label: string, value: boolean) => Promise<void>;
}

const REVEAL_SECONDS = 30;
/** 刚写入 / 编辑后多久内显示「判定中…」 */
const JUDGING_HINT_MS = 2 * 60_000;

/** 遮挡后是否还剩可以搜索的文字 */
function hasSearchableText(masked: string) {
  return masked.replace(/•+/g, "").replace(/[\s:：=*+#\-]/g, "") !== "";
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function MemoCard({ memo, terms = [], onUpdate, onDelete, onLabel }: Props) {
  const [editing, setEditing] = useState(false);
  const [editInitial, setEditInitial] = useState(memo.content);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 隐私 memo 显示原文时的原文和剩余秒数 */
  const [raw, setRaw] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [title, setTitle] = useState("");
  const shown = raw ?? memo.content;
  const html = useMemo(() => renderMarkdown(shown, terms), [shown, terms]);

  useEffect(() => setRaw(null), [memo.content]);
  useEffect(() => {
    if (raw === null) return;
    if (left <= 0) return setRaw(null);
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [raw, left]);

  async function reveal() {
    const r = await api.rawMemo(memo.id);
    setRaw(r.content);
    setLeft(REVEAL_SECONDS);
  }

  /** 隐私 memo 编辑时用原文 */
  async function startEdit() {
    setEditInitial(memo.private ? (raw ?? (await api.rawMemo(memo.id)).content) : memo.content);
    setEditing(true);
  }

  async function saveTitle() {
    const t = title.trim();
    if (!t) return;
    const original = (await api.rawMemo(memo.id)).content;
    await onUpdate(memo.id, `${t}\n${original}`);
    setTitle("");
  }

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
          initial={editInitial}
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
          {memo.private && <span className="lens-chip lens-private">隐私</span>}
          {memo.lenses?.includes("todo") && (
            <span className="lens-chip">
              待办
              <button aria-label="不是待办" title="不是待办" onClick={() => onLabel(memo.id, "todo", false)}>×</button>
            </span>
          )}
          {memo.judged === false && Date.now() - memo.updatedAt < JUDGING_HINT_MS && <span className="muted small">判定中…</span>}
          {memo.match?.keywordRank && <span className="hit-badge hit-keyword">关键词</span>}
          {memo.match?.semanticScore && (
            <span className="hit-badge hit-semantic" title="语义相似度（cosine）">语义 {memo.match.semanticScore.toFixed(2)}</span>
          )}
        </div>
        <div className="head-actions">
        {memo.private && (
          <button className="btn btn-ghost btn-sm" onClick={raw === null ? reveal : () => setRaw(null)}>
            {raw === null ? "显示原文" : `隐藏 · ${left}s`}
          </button>
        )}
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenu((v) => !v)} aria-label="更多">
            ···
          </button>
          {menu && (
            <div className="menu">
              <button
                onClick={() => {
                  setMenu(false);
                  startEdit();
                }}
              >
                编辑
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  navigator.clipboard.writeText(shown);
                }}
              >
                复制 Markdown
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  onLabel(memo.id, "private", !memo.private);
                }}
              >
                {memo.private ? "取消隐私" : "标记为隐私"}
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
        </div>
      </header>
      {shown.trim() && <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} onDoubleClick={startEdit} />}
      {memo.private && raw === null && !hasSearchableText(memo.content) && (
        <form
          className="title-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveTitle();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="添加标题，方便搜索" aria-label="标题" />
          <button className="btn btn-ghost btn-sm" disabled={!title.trim()}>保存</button>
        </form>
      )}
      {memo.attachments && memo.attachments.length > 0 && <Attachments list={memo.attachments} />}
      {memo.ask?.includes("todo") && (
        <div className="lens-ask small muted">
          这是待办吗？
          <button className="btn btn-ghost btn-sm" onClick={() => onLabel(memo.id, "todo", true)}>是</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onLabel(memo.id, "todo", false)}>不是</button>
        </div>
      )}
      {!memo.private && <Related memoId={memo.id} />}
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
