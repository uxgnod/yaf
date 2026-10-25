# yaf 路线图：v2 分析、设计与计划

> 最后更新：2026-10-25
> 状态：**开发中**，进度见 [V2-PLAN.md](./V2-PLAN.md)。界面改动清单见 [UI-CHANGES.md](./UI-CHANGES.md)。
> 原型（私有 Artifact）：https://claude.ai/artifact/FFZxFDbssjn2fLXvU6KPEB

## 0. 当前状态（v1，已上线）

- 线上：https://yaf.uxgnod.workers.dev ；仓库：https://github.com/uxgnod/yaf （public）
- 架构：单个 Cloudflare Worker（Hono API + React SPA 静态资源）+ D1（`yaf-db`）
- 已有功能：memo 增删改、Markdown 渲染、`#a/b/c` 层级标签、关键词搜索（LIKE）、邮箱 + 密码登录、首次启动创建 admin（需 `SETUP_TOKEN`）、按标签导出 md/json、亮 / 暗 / 跟随系统主题、统计 + 16 周热力图
- 部署：`npm run deploy`；改表结构后先 `npm run db:migrate:remote`

## 1. v2 的四个方向（用户已确认要做）

1. 向量 + 关键词混合检索
2. 自定义频率的深度洞察（类似 flomo「每日回顾」，但做跨时间的交叉关联）
3. API Token + CLI + MCP 服务器
4. 微信 ClawBot 接入：微信里发文字 / 图片 / 语音，存为 memo

## 2. 公共底座（四个方向的前置）

| 项 | 内容 |
|---|---|
| 表结构 | `memos.source`（web / wechat / api / mcp / cli）；新表 `attachments`、`api_tokens`、`insight_plans`、`insights`、`wechat_bindings`，以及向量同步状态 |
| R2 | 存图片和语音原文件（免费额度 10GB） |
| 异步处理 | 写入后的慢活（算向量、图片描述、语音转码）用 `ctx.waitUntil`；量大或需要重试的用 Workflows |
| 仓库结构 | 改成 pnpm workspaces：`apps/web`（Worker + 前端）、`packages/cli`、`packages/shared`（类型、标签提取、API 客户端） |
| 前端路由 | 新增 `/insights`、`/settings/*`；标签筛选继续用 `#tag=` hash |

## 3. 方向一：混合检索

```
写入 ─┬─ D1 FTS5（先用 Intl.Segmenter 切中文词，再写入 FTS 列）
      └─ waitUntil → Workers AI @cf/baai/bge-m3（1024 维）→ Vectorize（metadata: userId, createdAt）
查询 ─┬─ FTS5 BM25 前 30 条 ─┐
      └─ 查询向量 → Vectorize 前 30 条 ─┴→ RRF 融合 (1/(60+rank)) →（可选）bge-reranker-base → D1 取正文
```

- 中文分词：用 `Intl.Segmenter('zh', {granularity:'word'})`，索引和查询两端都切。不用 trigram（少于 3 个字的查询搜不到）。
- 返回命中原因 `{ keywordRank, semanticScore }`，前端据此显示标记和高亮。
- 算向量的文本：去掉 Markdown 语法，标签拼在前面；图片用视觉模型生成描述，语音用转写文字。
- 「相关笔记」：用 memo 自身的向量查最近邻。
- 存量数据：写一个 Workflow 分批补算向量。
- 额度：Vectorize 免费版约 500 万存储维度，按 1024 维约 4,800 条；超出后升级 Workers Paid（$5/月）。

## 4. 方向二：深度洞察

```
Cron（每 15 分钟）→ 查到期的 insight_plans（用 croner 解析 cron 表达式和时区）→ 每个计划启动一个 Workflow：
  1 取窗口内新 memo → 2 按向量召回历史 Top-K → 3 JS 里做聚类
  → 4 每个簇单独总结（Map）→ 5 汇总生成结构化报告（Reduce，generateObject + zod）
  → 6 校验引用的 memo id 是否存在（防止编造）→ 7 存 insights 表，按设置投递（站内 / 邮件 / 微信）
```

- 调用模型用 Vercel AI SDK：`workers-ai-provider`（免费，质量一般）或 `@ai-sdk/anthropic`（用户自带 API key，建议 `claude-sonnet-5-5`），请求都经过 AI Gateway。
- 报告结构：反复出现的主题 / 新的连接 / 想做未做 / 值得追问的问题。每条结论都要引用 memo。
- 分层记忆：周报作为月报的输入，月报作为季报的输入，控制 token 成本。
- 反馈：「有用 / 没用」存下来，下次生成时作为偏好提示；「存为 memo」让洞察也能被搜索和关联。
- 选 Workflows 而不是 Agents SDK：这件事不需要对话。以后要在洞察页追问时，再加 Agents SDK 的对话 agent。

## 5. 方向三：API Token / CLI / MCP

- **Token**：表 `api_tokens(id, user_id, name, prefix, token_hash, scopes, last_used_at, expires_at)`。格式 `yaf_pat_<随机串>`，库里只存 SHA-256。中间件同时接受 Cookie 和 Bearer。scope 有 `memos:read`、`memos:write`、`export`、`insights:read`。
- **API 契约**：用 `@hono/zod-openapi` 生成 OpenAPI 文档；仓库内的调用方用 Hono RPC（`hc<AppType>`）。
- **CLI**（`yaf-cli`）：citty 或 commander + `@clack/prompts` + tsdown；登录走设备码流程；命令有 `add`（支持管道输入）、`search`、`tags`、`export --tag`、`insight latest`；配置存在 `~/.config/yaf/`。
- **MCP**：`/mcp` 路径，用 Agents SDK 的 `createMcpHandler`（Streamable HTTP）+ `@modelcontextprotocol/sdk`。工具：`search_memos`、`add_memo`、`get_memo`、`get_related`、`list_tags`、`list_insights`。鉴权用 Token；要接入 Claude.ai 自定义连接器时，再加 `@cloudflare/workers-oauth-provider`（OAuth 2.1）。
- 收拢重复系统：用户在 Claude Code 里的 `/memos:*` skill 目前用 `~/.memos`，改为调用 yaf 的 MCP 或 CLI，以 yaf 为唯一数据源。

## 6. 方向四：微信 ClawBot 接入

### 协议（读 `@tencent-weixin/openclaw-weixin` v2.4.10 源码得出，MIT 许可）

| 项 | 内容 |
|---|---|
| 接口地址 | `https://ilinkai.weixin.qq.com`，JSON over HTTPS |
| 请求头 | `iLink-App-Id: bot`、`iLink-App-ClientVersion`（uint32：major<<16 \| minor<<8 \| patch）、`AuthorizationType: ilink_bot_token`、`Authorization: Bearer <bot_token>`、`X-WECHAT-UIN`（随机 uint32 转十进制字符串再 base64） |
| 扫码 | `GET ilink/bot/get_bot_qrcode?bot_type=…` 返回 `qrcode` 和 `qrcode_img_content`；长轮询 `GET ilink/bot/get_qrcode_status?qrcode=…`，状态有 `wait` / `scaned` / `need_verifycode` / `verify_code_blocked` / `expired` / `scaned_but_redirect`（带 `redirect_host`）/ `binded_redirect` / `confirmed`（返回 `bot_token`、`ilink_bot_id`、`baseurl`） |
| 收消息 | **只能长轮询，没有 webhook**：`POST ilink/bot/getupdates`，body 为 `{get_updates_buf, base_info}`，客户端超时约 35 秒 |
| 其他接口 | `sendmessage`（需带 `context_token`，只能在 24 小时内回复）、`sendtyping`、`getuploadurl`、`getconfig`、`msg/notifystart`、`msg/notifystop` |
| 消息项类型 | 1 文字、2 图片、3 语音（`voice_item.text` 是微信转写，原音频为 SILK）、4 文件、5 视频 |
| 媒体 | `https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=…`，AES-128-ECB 加密，密钥 `aes_key` |

### 在 Cloudflare 上的实现

- 设置页：Worker 代请求二维码，前端用 `qrcode` 库渲染，前端轮询 yaf 接口、Worker 再长轮询扫码状态。拿到的 `bot_token` 用 AES-GCM 加密（密钥放 Worker secret）后存进 D1。
- `WechatBridge` Durable Object 用 alarm 循环：getupdates → 按消息 id 去重 → 处理 → 保存游标 → 立刻设下一次 alarm。用 DO 是因为它单实例、串行执行，保证游标不会被并发推进。
- 文字直接存为 memo；图片下载 → 用 `@noble/ciphers` 的 ECB 解密（WebCrypto 不支持 ECB）→ 存 R2 → 后台用视觉模型生成描述；语音用 `voice_item.text` 作正文，SILK 原文件存 R2，用 `silk-wasm` 转成 wav 供回放。
- 回复「已记录 · #标签」；以后可以支持 `/搜 xxx` 这类指令。
- 额度：一个一直在线的 DO 每天约 10,800 GB-s，记忆中免费额度是每天 13,000 GB-s（以官方文档为准），**只够一个绑定**。

### 风险（开工前必须先验证）

1. 复用 OpenClaw 插件的身份（`iLink-App-Id: bot`）属于非官方接入，可能违反服务条款，也可能随时失效。
2. ClawBot 是实验功能、灰度放量中。同一个 bot 很可能只能连一个后端，绑定 yaf 可能挤掉 OpenClaw（待实测）。
3. 要做成独立的适配层，失效时不影响其他功能。

## 7. 实施顺序

> 每一步的具体任务和验收标准见 [V2-PLAN.md](./V2-PLAN.md)。

| 步骤 | 内容 | 理由 | 新增的 CF 组件 | 状态 |
|---|---|---|---|---|
| 0 | 微信验证原型（半天）：在 Worker 里跑通扫码、收一条文字、回复一条 | 不确定性最高，先验证 | DO | 待开始 |
| 1 | 底座 + API Token + MCP + CLI | 工作量最小，做完就能让 agent 读写 memo | — | 已完成（2026-10-25；npm 发布待做） |
| 2 | 混合检索 + 相关笔记 | 洞察依赖它 | Workers AI、Vectorize | 待开始 |
| 3 | 洞察 | 依赖第 2 步 | Workflows、Cron、AI Gateway | 待开始 |
| 4 | 微信正式接入 | 依赖附件、R2 和第 0 步结论 | DO、R2 | 待开始 |

## 8. 待决定的问题

- 洞察默认用哪个模型：Workers AI（免费）还是 Claude（自带 key）？
- 搜索结果排序：有搜索词时是按相关度还是保持按时间？（见 UI-CHANGES.md）
- 网页编辑器是否也支持上传图片？（原型里没画）

## 9. 决策记录

- 2026-10-16：登录方式从 magic link 改为邮箱 + 密码（用户要求）。
- 2026-10-16：部署前设置 `SETUP_TOKEN`，防止上线后被他人抢先注册 admin（口令本身不进仓库）。
- 2026-10-24：确定 v2 四个方向和上面的实施顺序（顺序为建议，待用户最终确认）。
- 2026-10-25：实施顺序调整为 1 → 2 → 3 → 0/4，微信（需要用户扫码配合）放到最后。
- 2026-10-25：仓库结构不改成 pnpm + `apps/web`，沿用 npm workspaces，Web 留在根目录，只新增 `packages/cli`。理由：现有部署脚本、vite / wrangler 配置都基于根目录，搬迁收益小、风险大；CLI 不依赖前端代码。
- 2026-10-25：MCP 用 `agents/mcp/server` 的 `createMcpHandler`（无状态，`@modelcontextprotocol/server` v2），鉴权在进入 handler 前用 Bearer Token 完成，每个工具再按 scope 校验。
- 2026-10-25：设备码登录在用户批准时只记录 user_id，CLI 轮询时才生成 Token 并删除设备码记录，库里不存明文；Token 管理和修改密码只接受网页会话，不接受 Token。
- 2026-10-25：「账号与安全」做账号信息、修改密码（成功后其他会话失效）、会话数 +「退出其他设备」。
- 2026-10-25：CLI 包名 `yaf-cli`，命令 `yaf`；用 Node 内置的 `parseArgs` + `fetch`，零运行时依赖，tsc 编译。
- 2026-10-25：Token 调用写入的 memo 来源记为 `api`，CLI 带 `X-Yaf-Source: cli` 记为 `cli`，MCP 记为 `mcp`。
