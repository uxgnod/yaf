# yaf 路线图：v2 分析、设计与计划

> 最后更新：2026-10-26
> 状态：v2 已上线（v0.2.1）；**v0.3 视图与隐私内容开发中**（设计见第 10 节），进度见 [V2-PLAN.md](./V2-PLAN.md)。界面改动清单见 [UI-CHANGES.md](./UI-CHANGES.md)。
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
| 请求头 | `iLink-App-Id: bot`（来自插件 package.json 的 `ilink_appid`）、`iLink-App-ClientVersion`（uint32：major<<16 \| minor<<8 \| patch）、`AuthorizationType: ilink_bot_token`、`Authorization: Bearer <bot_token>`、`X-WECHAT-UIN`（随机 uint32 转十进制字符串再 base64） |
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
| 0 | 微信验证原型（半天）：在 Worker 里跑通扫码、收一条文字、回复一条 | 不确定性最高，先验证 | DO | 已完成（2026-10-25） |
| 1 | 底座 + API Token + MCP + CLI | 工作量最小，做完就能让 agent 读写 memo | — | 已完成（2026-10-25；npm 发布待做） |
| 2 | 混合检索 + 相关笔记 | 洞察依赖它 | Workers AI、Vectorize | 已完成（2026-10-25） |
| 3 | 洞察 | 依赖第 2 步 | Workflows、Cron、AI Gateway | 已完成（2026-10-25） |
| 4 | 微信正式接入 | 依赖附件、R2 和第 0 步结论 | DO、R2 | 已完成（2026-10-25） |
| 5 | v0.2.1：卡片外点击退出编辑、授权码区块 | 用户 memo 里的改进项 | — | 已完成（2026-10-26） |
| 6 | v0.3：视图（Lens）+ 隐私内容 | 见第 10 节 | Workers AI Clef | 代码完成，本地验证通过，待上线（2026-10-26） |
| 7 | v0.4：侧栏 AI 用量圆环 | 见第 10 节末尾 | GraphQL Analytics API | 待做 |

## 8. 待决定的问题

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
- 2026-10-26：CLI 不内置默认服务地址（这是自部署项目，每个人的地址不同）：第一次 `yaf login` 没带 `--host` 时在终端询问，非交互环境直接报错；没写协议时默认 https，本机地址默认 http。npm 上 `yaf` 已被占用，包名用 `yaf-cli`，命令仍是 `yaf`。
- 2026-10-26：许可证参考 TREK：主项目 AGPL-3.0-only（适用于所有历史版本），名称和图标用 TRADEMARKS.md 单独保护（修改版和面向第三方的托管服务不能叫 yaf），CLI 保持 MIT；CONTRIBUTING.md 要求贡献者授予维护者重新授权的权利，为以后的商业授权留余地。代价：挡不住换名并公开源码的开源竞品。设置页侧边栏放「源码 · AGPL-3.0」链接（`src/project.ts`），满足 AGPL 第 13 条。
- 2026-10-26：最初的简单版打标签 `v0.1.0`（提交 027d0f6），v2 打 `v0.2.0`。README 拆成英文 `README.md` 和中文 `README.zh-CN.md`。
- 2026-10-25：Token 调用写入的 memo 来源记为 `api`，CLI 带 `X-Yaf-Source: cli` 记为 `cli`，MCP 记为 `mcp`。
- 2026-10-25：有搜索词时默认按相关度排序，摘要栏可切到按时间；混合检索一次最多返回 50 条，不分页。
- 2026-10-25：关键词检索 = FTS5（Intl.Segmenter 切词 + 前缀匹配，bm25 排序）+ 子串匹配兜底（补上切词不一致或尚未进索引的 memo，排在 FTS 结果之后）。
- 2026-10-25：语义检索阈值 cosine ≥ 0.53（bge-m3 实测：无关文本 0.45–0.52，相关 0.55+）；相关笔记阈值 0.55。语义检索失败时自动退化为关键词结果。
- 2026-10-25：「相关笔记」点开时才查询，不在每张卡片渲染时预查数量，避免一屏触发几十次向量查询。
- 2026-10-25：Vectorize 索引 `yaf-memos`（1024 维 cosine，`userId` 建了 metadata 过滤索引）。Vectorize 没有本地模拟，本地开发也连线上索引，按 userId 隔离。
- 2026-10-25：编辑 memo 时把 `vector_hash` 置空，再用 `waitUntil` 后台重算；失败的由 Cron（每 15 分钟）自动启动补算 Workflow，不需要手动操作。
- 2026-10-25：洞察默认模型 Workers AI `@cf/qwen/qwen3-30b-a3b-fp8`。实测：`qwen3.8-27b` 质量更好但长输入 2 分钟超时；`deepseek-v4-flash`、`glm-5.3-flash` 不在免费套餐；`gpt-oss-120b` 结构化输出解析失败；`llama-4-scout` 内容过于简略。Claude 默认 `claude-sonnet-5-5`，key 用 AES-GCM 加密存 D1，密钥是 Worker secret `ENCRYPTION_KEY`。
- 2026-10-25：交给模型的 memo 用短编号（W1 = 窗口内、H1 = 召回的历史），模型只引用编号；保存前换成真实 id，引用无效的条目整条丢弃；正文里残留的编号用正则去掉，引用以链接形式单独展示。
- 2026-10-25：窗口内 memo ≤ 24 条时不聚类、直接汇总；更多时用余弦 k-means（k = √(n/2)，2–6）分簇，每簇单独总结后再汇总。分层记忆（周报 → 月报）暂不做。
- 2026-10-25：计划存 cron + 时区（croner 计算下次时间）；界面上的「每天 / 每周 / 每月」转成 cron，另有自定义 cron。Cron 触发时先用条件更新推进 next_run_at，再启动 Workflow，避免重复生成。「试运行」= 保存并立即生成一份。
- 2026-10-25：「有用 / 没用」反馈会作为偏好提示带进同一计划的下一次生成；「存为 memo」生成带 `#洞察` 标签的 Markdown memo，并进入检索索引。
- 2026-10-25：第 0 步和第 4 步合并实现（用户要求微信放最后、尽量少打扰）。协议细节补充：`get_bot_qrcode` 是 POST（body `{local_token_list: []}`，`bot_type=3`）；`qrcode_img_content` 是要编码成二维码的链接（`liteapp.weixin.qq.com/q/...`），前端用 `qrcode` 库渲染；`getupdates` 的 `ret/errcode = -14` 表示 bot_token 失效；图片 `image_item.aeskey`（hex）优先于 `media.aes_key`。
- 2026-10-25：只收录扫码者本人（`ilink_user_id`）发来的消息；按 `message_id` 在 DO 的 SQLite 里去重（保留最近 2000 条）；游标存在 DO storage。
- 2026-10-25：R2 未开通（账户需在控制台启用），代码里 `MEDIA` 绑定是可选的：未开通时图片只保存 AI 描述，语音只保存微信转写。开通后创建 `yaf-media` bucket、取消 wrangler.jsonc 里的注释即可。
- 2026-10-25：语音回放暂不做：`silk-wasm` 是 Emscripten 构建，运行时用 fs / fetch 读取 .wasm，不能直接在 Workers 上运行；要支持需自己用 `instantiateWasm` 包一层，或在浏览器端解码。是否需要取决于实测 `voice_item.text` 是否总有值。
- 2026-10-26：来源标记从彩色文字标签改为时间后面的灰色图标（网页来源不显示），悬停 / 聚焦时提示「来自 xxx」。
- 2026-10-26：微信正文不再写 `[图片]`、`[语音] 转写中…` 之类的占位：图片、语音作为附件展示，带附件的 memo 允许正文为空。图片的 AI 描述只用于 `alt` / `title`、FTS 和向量，不在卡片上显示。没有任何文字的 memo 不算向量，但照样标记为已索引。
- 2026-10-26：「自动加 #微信」改为默认关闭（来源已经有图标），开启后可自定义标签；CLI / API / MCP 也各有一个自动标签开关（存 `user_settings.auto_tags`），在 API Token 页配置。服务端写入时追加，客户端不用改。已有绑定的 `autoTag` 由迁移 0006 统一改为关闭。
- 2026-10-25：图片描述模型 `@cf/mistralai/mistral-small-3.1-24b-instruct`（免费套餐可用，约 5 秒一张）。
- 2026-10-25：用户扫码绑定成功；实测语音消息带 `voice_item.text`（微信转写）。用户开通 R2，创建 `yaf-media` 并绑定为 `MEDIA`，之后收到的图片 / 语音会保存原文件（开通前收到的补不回来，微信下载链接会过期）。
- 2026-10-25：语音回放放到浏览器端：点播放时才动态加载 `silk-wasm`（wasm 约 92 KB gzip），把 R2 里的 SILK 解码成 24 kHz wav 再交给 `<audio>`。Workers 端不再转码，`attachments.playback_key` 保留未用。vite 需要 `optimizeDeps.exclude: ["silk-wasm"]`，否则预构建会打断 `new URL("silk.wasm", import.meta.url)`。
- 2026-10-26：卡片内编辑（双击或菜单进入）点击编辑器外部时自动退出：内容没改就取消，改过就保存；正文为空且不允许为空时保持编辑态。原因是双击本身是选词手势，容易误进编辑。
- 2026-10-26：设备授权页把授权码从提示句里拿出来，放在提示和按钮之间的独立区块里，大号等宽显示，下方提示「和终端里显示的代码一致时再授权」。
- 2026-10-26：分类和敏感识别改用 Workers AI 的 System One 决策模型 Clef（`@cf/cloudflare/clef-flash`，按输入 token 计费，输出不收费），不用正则 + 向量 + LLM 三层方案。实测 13 条真实 memo + 8 条构造样例：真实密码 memo 的 `sensitive` = 0.96，其余都 ≤ 0.03；单选「类别」在真实数据上区分度低（多数是学习笔记，置信度 0.1–0.5 的占 1/4），所以改成相互独立的 noul 标记（sensitive、todo），不做单选类别。clef-flash 单次约 1–2 秒（REST，从本机测），约 300–600 token。
- 2026-10-26：敏感 memo 的可搜索文本用「逐行遮挡」生成，不生成描述：每行一个 Clef noul 问题判断是否写出了凭据的值，命中的行整行遮挡（已实测）；计划改进为保留第一个分隔符（`：` `:` `=`）之前的标签、其后替换为 `••••`（未实测）；遮挡后的文本进 FTS 和向量，原文不进。Clairic 的 `list` 抽取不可用：非敏感 memo 里也会抽出 Redis、`$user`、`1` 等误报，真实密码 memo 上置信度为 0，并有疑似漏遮。
- 2026-10-26：「敏感」在界面上改名为「隐私」（视图名、卡片标记、菜单「标记为隐私」）；代码和数据里的 key 仍是 `private`。
- 2026-10-26：界面文案要短：不放解释性说明框，状态写进控件本身（如按钮「隐藏 · 30s」），细节放悬停提示。
- 2026-10-26：侧栏改版：顶部导航只留「全部笔记」「洞察」；头像 + 名字移到底部作为账户菜单（主题、设置、导出，分隔线下是退出登录），右侧放 AI 用量圆环（v0.4）；去掉 admin 标记（目前没有注册 / 邀请入口，只有一个用户，「账号与安全」页仍显示角色）。导出不放进各视图。
- 2026-10-26：标签树的展开图标从 10px 放大到 13px，可点区域 16×20px。
- 2026-10-26：v0.3 的五个细节：原文显示 30 秒后自动隐藏；还没判定的 memo 对 Token（CLI / API / MCP）暂时不可见；拿不准（灰区）时不自动归类，卡片上问用户；AI 用量 ≥ 80% 时圆环变橙；隐私图片默认盖住（图片判定放到 v0.3.x）。
- 2026-10-26：AI 用量圆环只统计 Workers AI 的 neurons（GraphQL `aiInferenceAdaptiveGroups`，按 modelId 汇总 `totalNeurons`；每天 10,000 免费，UTC 0 点重置）；悬停卡片显示总量 + 一条按功能分段的构成条（用量为 0 的不显示）。Workers / R2 等用量以后再加。

## 10. v0.3 设计：视图（Lens）与隐私内容

原型：画布最下面一排（Lenses / LabelStates / UsageRing）。执行清单见 V2-PLAN 第 6 步。

### 结构：判断 → 提取 → 处理规则

```
写入 / 编辑 memo
  → ① judge：所有视图的问题合成一次 Clef 调用（clef-flash，≤ 64 个 noul 问题）→ 写 memo_labels（所有分数都存）
  → ② 命中 private：逐行遮挡（每行一个 noul 问题）→ memos.masked_content
  → ③ 处理规则（代码）：private 不算向量、FTS 用遮挡文本、不进洞察 / 相关笔记、Token 看不到
  → ④ 非 private：照常算向量（judge 之后才算，保证顺序）
```

- 视图定义写在代码里（`worker/lenses.ts`）：`{ key, name, question, threshold, ask?: [下限, 上限], rev }`。新增视图 = 加一条定义；改问题或阈值后 `rev` + 1，补算任务会重判。以后真需要再搬进数据库、做设置页编辑器。
- 「提取」（Clairic）只预留位置，不实现：实测中文相对日期（明天、周五）基本算错，且「明天」错了还给 0.79 置信度。

### 数据（迁移 0007）

- `memo_labels(memo_id, user_id, label, score, source 'model'|'user', rev, updated_at)`，主键 `(memo_id, label)`。用户改过的（source = user）模型不覆盖。
- `memos.masked_content`：隐私 memo 遮挡后的文本，其余为 NULL。
- `memos.judged_rev`：判定时视图集的版本；NULL = 还没判定。编辑正文时清空。
- `memos.is_private`：是否隐私（由判定结果或用户标记得出，冗余存一份，各处过滤用）。

### 视图（第一版）

| key | 名称 | 判定 | 阈值 |
|---|---|---|---|
| `private` | 隐私 | 是否写出了可直接用于登录或访问账户的凭据（密码、API key、token、恢复码、私钥） | ≥ 0.8 |
| `todo` | 待办 | 是否记录了一件要去做的事 | ≥ 0.7；0.4–0.7 在卡片上问「这是待办吗？」 |

### 逐行遮挡

每个非空行一个 noul 问题（≥ 0.3 判为含凭据）；命中的行保留第一个分隔符（`：` `:` `=`）及之前的标签，后面换成 `••••`，没有分隔符就整行换成 `••••`。实测（2026-10-26）：真实密码 memo 7 行遮 5 行、无残留；构造样例全部正确。

### 处理规则（只在这几处检查 private）

| 位置 | 隐私 memo 的处理 |
|---|---|
| FTS / 子串兜底搜索 | 用 `masked_content` |
| 向量 / 相关笔记 / 洞察 | 不算向量（已有的删除），不出现在相关笔记和洞察材料里 |
| 列表 / 搜索结果 | 返回遮挡文本 + `private: true`；原文走 `GET /api/memos/:id/raw`（只接受网页会话） |
| Token（CLI / API / MCP） | 隐私 memo 和还没判定的 memo 都看不到 |
| 导出 | 默认导出遮挡文本；网页导出可勾选「包含隐私原文」 |
| 编辑 | 进入编辑时取原文；保存后重新判定 |

- 判定失败（模型不可用）：memo 保持未判定，Cron 每 15 分钟重试；未判定的 memo 网页照常显示，但不算向量。
- 成本：一条 memo 约 300–600 token，clef-flash 每百万输入 token 3,455 neurons，约 1–2 neurons / 条。

### 不在 v0.3 范围

图片判定（隐私截图跳过图片描述，放 v0.3.x）、截止时间提取、视图编辑器、端到端加密、AI 用量圆环（v0.4）。

### v0.4：AI 用量圆环

- Cron 每 15 分钟用 GraphQL Analytics API（`aiInferenceAdaptiveGroups`）拉当天（UTC）用量，按 modelId 映射到功能（向量 / 图片描述 / 洞察 / 分类），存 D1；`GET /api/usage/ai` 只给 admin。
- 需要一个只有「Account Analytics: Read」权限的 API Token（`wrangler secret put CF_ANALYTICS_TOKEN`）和账户 ID；套餐（free / paid）用配置项指定。
- 侧栏底部右侧一个圆环，悬停展开：今日用量 / 10,000、分段构成条、「Free 套餐 · N 小时后重置」「账户合计 · N 分钟前更新」。
- 2026-10-26：后台补索引（向量 / FTS）和「标为隐私」可能并发：补索引写 FTS 时加条件「memo 仍非隐私」，写完向量后再检查一次，被标为隐私的立刻删除向量。本地实测发现过原文进 FTS 的竞态，已修复。
- 2026-10-26：图片描述模型从 `mistral-small-3.1-24b` 换成 `@cf/qwen/qwen3.8-27b`（用户选择：数据量小时优先效果）。实测两张测试图：Qwen 认字最完整（Mistral 在 5 次中有 2 次把「用量圆环」认错），关掉思考（`chat_template_kwargs.enable_thinking = false`）后 2–3 秒、约 30–45 neurons 一张；不关会先写推理，正文被截断。更便宜的备选是 `gemma-4-26b-a4b-it`（约 4 neurons 一张，同样要关思考）。已有图片的描述不重算。
