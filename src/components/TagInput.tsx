import { useState, type KeyboardEvent } from "react";

/** 标签输入：回车 / 逗号 / 空格添加，× 或空输入时退格删除。至少保留一个 */
export function TagInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const t = draft.trim().replace(/^#+/, "").replace(/\s+/g, "");
    setDraft("");
    if (t && !value.includes(t)) onChange([...value, t]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === "," || e.key === "，" || e.key === " ") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length > 1) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={"tag-input" + (disabled ? " disabled" : "")}>
      {value.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
          {!disabled && value.length > 1 && (
            <button type="button" aria-label={`移除标签 ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              ×
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder="输入标签，回车添加"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}
