import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeTag, TAG_RE, TRAILING_PUNCT } from "../shared/tags";

marked.setOptions({ gfm: true, breaks: true });

/** 在渲染后的 DOM 中把 #tag 文本替换为可点击的标签（跳过 code/pre/a） */
function linkifyTags(root: HTMLElement, allowed?: Set<string>) {
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
      if (!tag || (allowed && !allowed.has(tag))) continue;
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

/** 把节点包进一个 span，放回原来的位置 */
function wrap(nodes: Node[], className: string) {
  if (!nodes.length) return;
  const span = document.createElement("span");
  span.className = className;
  nodes[0].parentNode!.insertBefore(span, nodes[0]);
  for (const n of nodes) span.appendChild(n);
}

/** 「— 来源」：破折号开头，后面有字 */
const FROM_RE = /^\s*(?:—{1,2}|―)\s*\S/u;

/**
 * 引用块：最后一段最后一行以「— 」开头的是来源行（marked 把同段里的换行转成 <br>），
 * 加上 quote-from；其余是摘抄正文，加上 quote-text。样式只认这两个类名，没有来源行的普通引用照常显示。
 */
function decorateQuotes(root: HTMLElement, fromLine: boolean) {
  if (fromLine) {
    for (const p of Array.from(root.children)) {
      if (p.tagName === "P" && !p.querySelector("br") && FROM_RE.test(p.textContent ?? "")) p.classList.add("quote-from", "loose");
    }
  }
  root.querySelectorAll("blockquote").forEach((bq) => {
    for (const p of Array.from(bq.children)) {
      if (p.tagName !== "P") continue;
      const nodes = Array.from(p.childNodes);
      let br = -1;
      for (let i = nodes.length - 1; i >= 0; i--) {
        if ((nodes[i] as Element).tagName === "BR") {
          br = i;
          break;
        }
      }
      const tail = nodes.slice(br + 1);
      const isSource = p === bq.lastElementChild && FROM_RE.test(tail.map((n) => n.textContent ?? "").join(""));
      if (isSource && br < 0) {
        p.classList.add("quote-from"); // 整段都是来源
        continue;
      }
      wrap(isSource ? nodes.slice(0, br) : nodes, "quote-text");
      if (isSource) {
        nodes[br].remove();
        wrap(tail, "quote-from");
      }
    }
  });
}

export interface RenderOptions {
  /** 这条 memo 真正的标签；给了就只把这些渲染成标签块（划线里的 #include 之类不是标签） */
  tags?: string[];
  /** 正文里单独一行的「— 来源」也用小字样式（微信读书的章节点评、书评没有引用块） */
  fromLine?: boolean;
}

export function renderMarkdown(src: string, terms: string[] = [], opts: RenderOptions = {}): string {
  const html = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { RETURN_DOM: true }) as HTMLElement;
  decorateQuotes(clean, Boolean(opts.fromLine));
  linkifyTags(clean, opts.tags ? new Set(opts.tags) : undefined);
  highlight(clean, terms);
  clean.querySelectorAll("a[href]:not(.tag)").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  return clean.innerHTML;
}
