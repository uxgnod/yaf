# 发布清单（维护者）

目标：任何版本的用户升到任何新版本，线上都不出事。下面的规则就是「不出事」的全部依据，发布前逐条确认。

## 兼容规则（写代码时遵守）

1. **迁移只增不改**：只允许 `CREATE TABLE`、`CREATE INDEX`、`ADD COLUMN`（必须有 `DEFAULT` 或可为 NULL）。不允许 `DROP`、`RENAME`、改列类型、给已有列加 `NOT NULL`、改旧迁移文件。确需删除的，分两个版本：先停用，下个大版本再删。
2. **旧代码能跑在新表结构上**：升级顺序是「先迁移、后部署」，回滚是只回滚代码。所以版本 N-1 的代码必须能在版本 N 的表结构上正常工作。
3. **不悄悄多要东西**：新增必需的 secret / 资源 / 绑定，必须写进 `CHANGELOG.md`，而且代码在缺失时要有降级（隐藏功能或明确提示），不能让整站 500。
4. **固定的资源参数不改**：Vectorize 的维度和度量、D1 / Vectorize / R2 的名字、Durable Object 的 `migrations` tag 历史只能追加。
5. **`wrangler.jsonc` 不放个人值**：`database_id`、账户 ID、域名、token 都不进仓库。

## 发布步骤

1. `npm run typecheck`，`npm run build`。
2. 从零迁移：删掉 `.wrangler/state` 后 `npm run db:migrate:local`，七个以上文件都 ✅。
3. 升级迁移：用上一个 tag 的本地库（`git stash` 或另一个 worktree 先迁到旧版本），再迁到新版本。
4. 对照规则 1–2 看 `git diff <上一个tag>..HEAD -- migrations wrangler.jsonc`。
5. 全仓库扫描个人信息：`git grep -nIE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|workers\.dev|CF_|sk-ant-'`，结果只应是文档里的占位和代码里的变量名。
6. 更新 `CHANGELOG.md`（迁移 / 资源 / secret / 需要用户操作的事）、`package.json` 的 version、README 的版本表。
7. 提交，`git tag vX.Y.Z`，`git push origin main --tags`。
8. 在 GitHub 建 Release，正文 = CHANGELOG 对应条目 + 升级指引链接（`gh release create vX.Y.Z --notes-file …`）。
9. 自己的线上实例用 `deploy` 分支，按 `docs/AGENT-UPGRADE.md` 升级一遍，等于每次发布都演练一次用户流程。

## 出问题时

- 已发布的 tag 不改、不删。有问题就发 `vX.Y.Z+1` 修复，并在 CHANGELOG 里写明。
- 数据层面的最后手段是 D1 Time Travel（30 天）。
