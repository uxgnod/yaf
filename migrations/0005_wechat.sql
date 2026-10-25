-- v2 第 4 步：微信接入、附件

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- image | voice
  r2_key TEXT,                 -- 原文件（图片 / SILK）；R2 未开通时为空
  playback_key TEXT,           -- 语音转码后的 wav，供浏览器回放
  mime TEXT,
  size INTEGER,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  description TEXT,            -- 图片描述 / 语音转写，用于搜索和向量
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attachments_memo ON attachments(memo_id);

-- 每个用户最多一个微信绑定。bot_token 用 ENCRYPTION_KEY 加密
CREATE TABLE wechat_bindings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,        -- pending（扫码中）| active | error | unbound
  bot_token_enc TEXT,
  bot_id TEXT,
  wechat_user_id TEXT,         -- 扫码的微信用户，只收录这个人发来的消息
  base_url TEXT,
  rules TEXT NOT NULL DEFAULT '{}',
  login_qrcode TEXT,           -- 扫码中：二维码标识
  login_host TEXT,             -- 扫码中：scaned_but_redirect 之后的新域名
  login_verify_code TEXT,
  login_started_at INTEGER,
  last_event_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
