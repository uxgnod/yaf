// 从 memo 内容中提取 #tag，支持 #a/b/c 层级。前后端共用。
// 规则：# 必须位于行首或空白之后，后接非空白字符；`# 标题` 这类 Markdown 标题不会被识别。
export const TAG_RE = /(^|\s)#([^\s#]+)/gu;
export const TRAILING_PUNCT = /[.,;:!?，。；：！？、)）\]】"'”’]+$/u;

export function normalizeTag(raw: string): string | null {
  const cleaned = raw.replace(TRAILING_PUNCT, "");
  const parts = cleaned.split("/").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts.join("/") : null;
}

/** 去掉代码块和行内代码，避免把代码里的 # 当成标签 */
function stripCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  for (const m of stripCode(content).matchAll(TAG_RE)) {
    const tag = normalizeTag(m[2]);
    if (tag) tags.add(tag);
  }
  return [...tags];
}
