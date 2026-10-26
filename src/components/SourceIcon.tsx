// 来源图标：网页来源不显示；其余渠道一个线性图标，悬停 / 聚焦时显示「来自 xxx」
const PATHS: Record<string, string[]> = {
  wechat: [
    "M9.5 4C5.4 4 2 6.8 2 10.2c0 1.9 1 3.6 2.7 4.7L4 17.5l2.9-1.5c.8.2 1.7.3 2.6.3",
    "M15.5 9c3.6 0 6.5 2.4 6.5 5.3 0 1.6-.9 3-2.3 4l.6 2.2-2.5-1.3c-.7.2-1.5.3-2.3.3-3.6 0-6.5-2.4-6.5-5.2S11.9 9 15.5 9z",
  ],
  cli: ["M4 7l5 5-5 5", "M12 18h8"],
  api: [
    "M8 4c-2 0-3 1-3 3v2c0 1.5-.8 2.5-2 3 1.2.5 2 1.5 2 3v2c0 2 1 3 3 3",
    "M16 4c2 0 3 1 3 3v2c0 1.5.8 2.5 2 3-1.2.5-2 1.5-2 3v2c0 2-1 3-3 3",
  ],
  mcp: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"],
};

export const SOURCE_LABEL: Record<string, string> = {
  wechat: "来自微信",
  cli: "来自命令行",
  api: "来自 API",
  mcp: "来自 AI 助手（MCP）",
};

export function SourceGlyph({ source, size = 13 }: { source: string; size?: number }) {
  const paths = PATHS[source];
  if (!paths) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function SourceIcon({ source }: { source: string }) {
  const label = SOURCE_LABEL[source];
  if (!label || !PATHS[source]) return null;
  return (
    <span className="source-icon" role="img" aria-label={label} data-tip={label} tabIndex={0}>
      <SourceGlyph source={source} />
    </span>
  );
}
