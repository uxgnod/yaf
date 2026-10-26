-- 按来源自动加标签（CLI / API / MCP）；微信的配置仍在 wechat_bindings.rules
ALTER TABLE user_settings ADD COLUMN auto_tags TEXT;

-- 微信「自动加 #微信」改为默认关闭：旧绑定里的 true 是绑定时写入的默认值，不是用户的选择
UPDATE wechat_bindings SET rules = json_set(rules, '$.autoTag', json('false')) WHERE json_valid(rules);
