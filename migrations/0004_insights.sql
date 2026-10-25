-- v2 第 3 步：洞察

-- 洞察计划：cron 表达式 + 时区决定何时生成；分析窗口内的 memo 是主要材料，再按向量召回历史 memo
CREATE TABLE insight_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL,            -- daily | weekly | monthly | custom（界面上的频率）
  cron TEXT NOT NULL,               -- 实际使用的 cron 表达式
  timezone TEXT NOT NULL,
  scope_tags TEXT NOT NULL DEFAULT '[]', -- JSON 数组；空 = 全部 memo
  window_days INTEGER NOT NULL,
  perspective TEXT NOT NULL DEFAULT 'balanced', -- balanced | patterns | actions | questions
  extra_prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'workers-ai',      -- workers-ai | claude
  delivery TEXT NOT NULL DEFAULT 'inapp',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_insight_plans_due ON insight_plans(enabled, next_run_at);
CREATE INDEX idx_insight_plans_user ON insight_plans(user_id);

CREATE TABLE insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES insight_plans(id) ON DELETE SET NULL,
  plan_name TEXT,
  status TEXT NOT NULL,             -- generating | ready | failed
  title TEXT,
  content TEXT,                     -- JSON：报告正文（引用已校验）
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  memo_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  error TEXT,
  feedback TEXT,                    -- useful | useless
  read_at INTEGER,
  saved_memo_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_insights_user_created ON insights(user_id, created_at DESC);

-- 用户级设置：Claude API key（AES-GCM 加密，密钥在 Worker secret ENCRYPTION_KEY）
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  anthropic_key_enc TEXT,
  updated_at INTEGER NOT NULL
);
