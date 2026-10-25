-- v2 第 1 步：memo 来源、API Token、CLI 设备码登录

ALTER TABLE memos ADD COLUMN source TEXT NOT NULL DEFAULT 'web';

-- API Token：库里只存 SHA-256；scopes 用空格分隔
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

-- 设备码登录（CLI）：批准后在 CLI 轮询时才生成 Token，库里不存明文
CREATE TABLE device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
