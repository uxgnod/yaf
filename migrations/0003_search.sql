-- v2 第 2 步：混合检索

-- 向量状态：最近一次写入 Vectorize 的文本哈希；NULL 表示还没有向量（新写入、已编辑或待重建）
ALTER TABLE memos ADD COLUMN vector_hash TEXT;
CREATE INDEX idx_memos_user_vector ON memos(user_id, vector_hash);

-- 全文索引：body 是先用 Intl.Segmenter 切好、以空格分隔的词，再交给 unicode61 分词
CREATE VIRTUAL TABLE memos_fts USING fts5(body, memo_id UNINDEXED, user_id UNINDEXED, tokenize = 'unicode61');

-- 每个用户当前的补算 / 重建任务（Workflow 实例 id）
CREATE TABLE index_jobs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  started_at INTEGER NOT NULL
);
