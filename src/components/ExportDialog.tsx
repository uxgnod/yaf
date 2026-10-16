import { useState } from "react";
import { api, type TagCount } from "../api";

interface Props {
  tags: TagCount[];
  defaultTag: string | null;
  onClose: () => void;
}

export function ExportDialog({ tags, defaultTag, onClose }: Props) {
  const [tag, setTag] = useState(defaultTag ?? "");
  const [format, setFormat] = useState<"md" | "json">("md");

  // 父级标签也可单独导出（会包含所有子标签）
  const allPaths = [...new Set(tags.flatMap(({ tag }) => tag.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))))].sort();

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>导出笔记</h2>
        <p className="muted small">导出为 Markdown 或 JSON，方便交给 AI 分析。选择父标签时会包含其全部子标签。</p>
        <label>
          <span>标签</span>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部笔记</option>
            {allPaths.map((p) => (
              <option key={p} value={p}>
                #{p}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented">
          <button className={format === "md" ? "on" : ""} onClick={() => setFormat("md")}>Markdown</button>
          <button className={format === "json" ? "on" : ""} onClick={() => setFormat("json")}>JSON</button>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <a className="btn btn-primary" href={api.exportUrl({ tag: tag || undefined, format })} onClick={onClose}>
            下载
          </a>
        </div>
      </div>
    </div>
  );
}
