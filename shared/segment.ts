// 中文分词：用浏览器 / Workers 内置的 Intl.Segmenter（ICU 词典），前后端共用。
// 全文索引和查询两端都先切词，避免 trigram 搜不到两个字的词。
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/** 切出有意义的词（去掉标点和空白），统一小写 */
export function segmentWords(text: string): string[] {
  const out: string[] = [];
  for (const s of segmenter.segment(text)) if (s.isWordLike) out.push(s.segment.toLowerCase());
  return out;
}

/** 搜索词：用户输入按空格拆开，每段再切词；去重 */
export function queryTerms(q: string): string[] {
  return [...new Set(q.trim().split(/\s+/).filter(Boolean).flatMap((w) => segmentWords(w)))];
}
