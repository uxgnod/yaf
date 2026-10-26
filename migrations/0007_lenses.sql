-- v0.3：视图（Lens）与隐私内容

-- 每条 memo 在每个视图上的判定结果；所有分数都存，改阈值不用重判
-- source = user：用户手动改过，模型重判时不覆盖
CREATE TABLE memo_labels (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  score REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'model',
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (memo_id, label)
);
CREATE INDEX idx_memo_labels_user_label ON memo_labels(user_id, label, score);

-- 隐私 memo 遮挡后的文本（搜索、Token、导出用）；其余为 NULL
ALTER TABLE memos ADD COLUMN masked_content TEXT;
-- 判定时的视图集版本；NULL = 还没判定（编辑正文时清空）
ALTER TABLE memos ADD COLUMN judged_rev INTEGER;
-- 是否隐私（由 memo_labels 推导后冗余存一份，方便各处过滤）
ALTER TABLE memos ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_memos_user_judged ON memos(user_id, judged_rev);
