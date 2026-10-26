# Contributing · 参与贡献

[English](#english) · [中文](#中文)

---

## English

Thanks for your interest in yaf. The project is still under active development, so please open an issue to discuss a change before sending a large pull request.

- Run `npm run typecheck` before committing.
- Schema changes go in a new numbered file under `migrations/`. Never edit an existing migration.
- Never commit secrets. Use `wrangler secret put` and `.dev.vars` (ignored by git).

### License of contributions

By submitting a pull request, you agree that:

1. your contribution is licensed under the [GNU AGPL-3.0](LICENSE) (or the [MIT License](packages/cli/LICENSE) for code under `packages/cli/`), the same as the rest of the project; and
2. you grant the yaf maintainer a perpetual, worldwide, royalty-free, irrevocable license to use, modify and relicense your contribution, including under other license terms.

You keep the copyright to your contribution. You confirm that you have the right to submit it.

---

## 中文

感谢你对 yaf 的关注。项目仍在活跃开发中，较大的改动请先开 issue 讨论，再提交 PR。

- 提交前运行 `npm run typecheck`。
- 修改表结构时，在 `migrations/` 下新增编号递增的文件，不要改动已有的迁移文件。
- 不要提交任何密钥。用 `wrangler secret put` 和 `.dev.vars`（已被 git 忽略）。

### 贡献的授权

提交 PR 即表示你同意：

1. 你的贡献以 [GNU AGPL-3.0](LICENSE) 授权（`packages/cli/` 下的代码以 [MIT](packages/cli/LICENSE) 授权），与项目其余部分一致；
2. 你授予 yaf 维护者永久、全球、免费、不可撤销的许可，可以使用、修改你的贡献，并以其他许可条款重新授权。

你保留对贡献的著作权，并确认你有权提交这些内容。
