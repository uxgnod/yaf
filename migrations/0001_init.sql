-- 用户：保留多用户结构，role = admin | member
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);

-- 会话（只存哈希）
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_memos_user_created ON memos(user_id, created_at DESC);

-- 标签：存完整路径，如 a/b/c；查询父标签时用前缀匹配
CREATE TABLE memo_tags (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memo_id, tag)
);
CREATE INDEX idx_memo_tags_user_tag ON memo_tags(user_id, tag);
