import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeTag, TAG_RE, TRAILING_PUNCT } from "../shared/tags";

marked.setOptions({ gfm: true, breaks: true });

/** 在渲染后的 DOM 中把 #tag 文本替换为可点击的标签（跳过 code/pre/a） */
function linkifyTags(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (p?.closest("code, pre, a")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue?.includes("#") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const text = node.nodeValue!;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(TAG_RE)) {
      const tag = normalizeTag(m[2]);
      if (!tag) continue;
      const start = m.index! + m[1].length;
      // 原文里标签的长度：# + 去掉尾部标点后的部分（标点留在标签外）
      const rawLen = 1 + m[2].replace(TRAILING_PUNCT, "").length;
      frag.append(text.slice(last, start));
      const a = document.createElement("a");
      a.className = "tag";
      a.dataset.tag = tag;
      a.href = `#tag=${encodeURIComponent(tag)}`;
      a.textContent = text.slice(start, start + rawLen);
      frag.append(a);
      last = start + rawLen;
    }
    if (last === 0) continue;
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/** 把命中的搜索词包成 <mark>（跳过代码块） */
function highlight(root: HTMLElement, terms: string[]) {
  const words = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue!;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(last, m.index));
      const mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index! + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

export function renderMarkdown(src: string, terms: string[] = []): string {
  const html = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { RETURN_DOM: true }) as HTMLElement;
  linkifyTags(clean);
  highlight(clean, terms);
  clean.querySelectorAll("a[href]:not(.tag)").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  return clean.innerHTML;
}
