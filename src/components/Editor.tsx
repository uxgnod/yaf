import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  initial?: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  onSubmit: (content: string) => Promise<void>;
  /** 带附件的 memo 允许清空正文 */
  allowEmpty?: boolean;
  onCancel?: () => void;
  /** 点击编辑器外部时：内容没改就取消，改过就保存（用于卡片内编辑，避免双击误触后一直停在编辑态） */
  closeOnOutsideClick?: boolean;
}

/** 在选区两侧包裹标记，或在行首插入前缀 */
function applyFormat(el: HTMLTextAreaElement, kind: "bold" | "list" | "ordered" | "code" | "tag"): string {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const sel = value.slice(s, e);
  let next = value;
  let cursor = e;
  if (kind === "bold" || kind === "code") {
    const mark = kind === "bold" ? "**" : "`";
    next = value.slice(0, s) + mark + sel + mark + value.slice(e);
    cursor = sel ? e + mark.length * 2 : s + mark.length;
  } else if (kind === "tag") {
    const needSpace = s > 0 && !/\s/.test(value[s - 1]);
    const ins = (needSpace ? " " : "") + "#";
    next = value.slice(0, s) + ins + value.slice(e);
    cursor = s + ins.length;
  } else {
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const prefix = kind === "list" ? "- " : "1. ";
    next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    cursor = e + prefix.length;
  }
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(cursor, cursor);
  });
  return next;
}

export function Editor({ initial = "", placeholder = "现在的想法是…", submitLabel = "发送", autoFocus, allowEmpty, onSubmit, onCancel, closeOnOutsideClick }: Props) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 自适应高度
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 480) + "px";
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      const el = ref.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!closeOnOutsideClick || !onCancel) return;
    const onDown = (e: MouseEvent) => {
      if (busy || rootRef.current?.contains(e.target as Node)) return;
      if (value === initial) onCancel();
      else submit();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  async function submit() {
    if ((!value.trim() && !allowEmpty) || busy) return;
    setBusy(true);
    try {
      await onSubmit(value);
      // 新建模式（无取消按钮）提交后重置为初始内容；编辑模式由父组件关闭
      if (!onCancel) setValue(initial);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && onCancel) {
      onCancel();
    }
  }

  const fmt = (kind: Parameters<typeof applyFormat>[1]) => () => ref.current && setValue(applyFormat(ref.current, kind));

  return (
    <div className="editor" ref={rootRef}>
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
      />
      <div className="editor-bar">
        <div className="editor-tools">
          <button type="button" className="icon-btn" title="标签" onClick={fmt("tag")}>#</button>
          <button type="button" className="icon-btn" title="加粗" onClick={fmt("bold")}><b>B</b></button>
          <button type="button" className="icon-btn" title="无序列表" onClick={fmt("list")}>•</button>
          <button type="button" className="icon-btn" title="有序列表" onClick={fmt("ordered")}>1.</button>
          <button type="button" className="icon-btn mono" title="行内代码" onClick={fmt("code")}>{"</>"}</button>
        </div>
        <div className="editor-actions">
          <span className="hint">⌘ + Enter</span>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>取消</button>
          )}
          <button type="button" className="btn btn-primary" disabled={(!value.trim() && !allowEmpty) || busy} onClick={submit}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
