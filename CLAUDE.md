# yaf

flomo 复刻，跑在 Cloudflare Workers + D1 上。用法和部署见 README.md。

## 开工前先读

以下三份在 `docs/dev/`，已被 .gitignore 忽略，只存在于维护者本地，不会提交。

- `docs/dev/ROADMAP.md`：v2 的分析、设计、实施顺序、待决定问题和决策记录。
- `docs/dev/V2-PLAN.md`：v2 开发计划，按步骤列出前端 / 后端任务和验收标准。开发进度只在这里勾选。
- `docs/dev/UI-CHANGES.md`：v2 界面改动清单（删除 / 保留 / 新增 / 行为变化），改界面前先对照，不要删掉现有功能。

完成一个阶段或做出新决定后，同步更新 ROADMAP 的「状态」列和「决策记录」。

## 约定

- 回答使用中文。
- 改表结构：在 `migrations/` 新增编号递增的 SQL 文件，不改旧文件；本地 `npm run db:migrate:local`，线上 `npm run db:migrate:remote`。
- 提交前跑 `npm run typecheck`。
- 仓库是 public：不要提交任何密钥（`SETUP_TOKEN`、API key 等用 `wrangler secret put`）。
