# yaf v2 开发计划

> 最后更新：2026-10-26（第 5 步完成，第 6 步开发中）
> 本文件是 v2 的**执行清单**：每一步具体做什么、做完怎么验收。设计理由和技术细节见 [ROADMAP.md](./ROADMAP.md)，界面改动的确认记录见 [UI-CHANGES.md](./UI-CHANGES.md)。
> 原型（私有 Artifact）：https://claude.ai/artifact/FFZxFDbssjn2fLXvU6KPEB

## 使用方式

- 每完成一项，把 `[ ]` 改成 `[x]`；一个步骤全部完成后，同步更新 ROADMAP 第 7 节的「状态」列。
- 开发进度**只在本文件勾选**。UI-CHANGES.md 只用于确认界面改动，确认后不再维护。
- 原则：**不删除任何现有功能**（侧边栏统计、热力图、标签树、输入框、卡片菜单、导出、主题等全部保留）。
- 所有新界面同时做亮色和暗色，手机宽度下可用。

## 总览

| 步骤 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| 0 | 微信验证原型 | — | 已完成（扫码、收消息、语音转写已验证） |
| 1 | 底座 + API Token + MCP + CLI | — | 已完成（npm 发布待用户登录） |
| 2 | 混合检索 + 相关笔记 | 1（底座） | 已完成 |
| 3 | 洞察 | 2 | 已完成 |
| 4 | 微信正式接入 | 0 的结论、1（附件 / 来源） | 已完成 |
| 5 | v0.2.1 小改动 | — | 已完成 |
| 6 | v0.3 视图（Lens）+ 隐私内容 | 2 | 代码完成，待上线 |
| 7 | v0.4 侧栏 AI 用量圆环 | — | 待做 |

---

## 第 0 步：微信验证原型（半天，不改界面）

目标：确认 ClawBot 协议在 Worker 上可用，再决定第 4 步做不做。

- [x] 在 Worker 里请求二维码（`get_bot_qrcode`，POST + `bot_type=3`），手机扫码绑定成功（2026-10-25）
- [x] 轮询扫码状态（`get_qrcode_status`）直到 `confirmed`，拿到 `bot_token`
- [x] 长轮询 `getupdates` 收到文字、图片、语音消息（线上 2026-10-25 21:52–21:57）
- [ ] 用 `sendmessage` 回复「已记录」（代码已做，待用户确认微信里是否收到）
- [x] 实测：发一条语音，`voice_item.text` 有值（3.6 秒的语音，微信给了转写）
- [ ] 实测：绑定 yaf 后，原来连接的 OpenClaw 是否被断开
- [x] 结论写进 ROADMAP 第 9 节（决策记录）

**验收**：在微信里发一条文字，Worker 日志里能看到，并且微信能收到回复。

---

## 第 1 步：底座 + API Token + MCP + CLI

### 后端
- [x] 迁移：`memos.source`（web / wechat / api / mcp / cli，默认 web）
- [x] 迁移：`api_tokens(id, user_id, name, prefix, token_hash, scopes, last_used_at, expires_at, created_at)`
- [x] Token 生成：`yaf_pat_<随机串>`，库里只存 SHA-256
- [x] 鉴权中间件同时接受 Cookie 和 `Authorization: Bearer`，并按 scope 校验（`memos:read`、`memos:write`、`export`、`insights:read`）
- [x] Token 管理接口：列表、新建（只返回一次明文）、撤销
- [x] 写入 memo 时记录 `source`；用 Token 调用时更新 `last_used_at`
- [x] `/mcp` 端点（Agents SDK `createMcpHandler`，Streamable HTTP），工具：`search_memos`、`add_memo`、`get_memo`、`list_tags`（`get_related`、`list_insights` 等第 2、3 步再加）
- [x] 设备码登录（device code）接口，供 CLI 使用

### 前端
- [x] 路由：`/settings/*`、`/insights`（洞察页先占位）；标签筛选继续用 `#tag=`
- [x] 主侧边栏导航新增「设置」
- [x] 设置页布局：专用侧边栏（「← 返回笔记」+ 账号与安全 / API Token / 微信连接 / 洞察与搜索）
- [x] 账号与安全：账号信息、修改密码（成功后其他会话失效）、登录会话数 +「退出其他设备」
- [x] API Token 页：列表（名称、权限、最近使用、过期、撤销）
- [x] API Token 页：新建弹窗（名称、权限、过期时间）；成功后显示绿色提示框 + 复制按钮，**只显示一次**
- [x] API Token 页：MCP 接入说明卡片（`claude mcp add --transport http yaf https://yaf.uxgnod.workers.dev/mcp`）
- [x] API Token 页：CLI 安装说明卡片
- [x] memo 卡片：来源标记（来自 API / CLI / MCP；web 来源不显示）

### CLI（`packages/cli`）
- [x] 仓库改为 workspaces：沿用 npm（已有 package-lock），Web 留在根目录，新增 `packages/cli`（见 ROADMAP 决策记录 2026-10-25）
- [x] `yaf login`（设备码流程，配置存 `~/.config/yaf/`）
- [x] `yaf add`（支持管道输入）、`yaf search`、`yaf tags`、`yaf export --tag`
- [ ] 发布到 npm（包名 `yaf-cli`，命令 `yaf`；需要用户在本机 `npm login` 后执行 `npm publish -w yaf-cli`）

**验收**：在 Claude Code 里通过 MCP 搜索和新增 memo；`echo "想法 #inbox" | yaf add` 能写入；撤销 Token 后立即失效。

---

## 第 2 步：混合检索 + 相关笔记

### 后端
- [x] 迁移：FTS5 表；写入时用 `Intl.Segmenter('zh', {granularity:'word'})` 切词后再入索引，查询端同样切词
- [x] 写入 / 编辑 / 删除时同步 FTS 和向量（向量用 `ctx.waitUntil` 后台算）
- [x] Workers AI `@cf/baai/bge-m3` 生成向量，存 Vectorize（metadata：userId、createdAt）
- [x] 搜索接口新增 `mode=hybrid|keyword|semantic` 和排序参数；混合模式用 RRF 融合（`1/(60+rank)`）
- [x] 返回命中原因 `{ keywordRank, semanticScore }`
- [x] 相关笔记接口：用 memo 自身向量查最近邻，排除自己
- [x] Workflow：存量 memo 分批补算向量；索引状态接口（已索引 / 总数）；Cron 每 15 分钟自动补算缺失的向量
- [x] MCP 新增工具 `get_related`

### 前端
- [x] 搜索模式切换：混合 / 关键词 / 语义，**仅在输入了搜索词时显示**，默认混合
- [x] 结果摘要栏：「找到 N 条 · 关键词 X · 语义 Y」+「相关度 / 时间」排序切换
- [x] 卡片命中标记：「关键词」「语义 0.84」
- [x] 关键词高亮
- [x] ⌘K 聚焦搜索框
- [x] 搜索框保持「左标题、右搜索」布局，聚焦时展开变宽
- [x] memo 卡片：「相关笔记」，默认收起，点开后查询并显示「相关笔记 · N」和最多 3 条（不在每张卡片加载时预查数量，见决策记录）
- [x] 设置 › 洞察与搜索：「语义搜索索引」区块（同步状态、进度条、重建索引；显示「融合方式：RRF」，不显示权重）

**验收**：搜「睡眠」能找到没写「睡眠」这个词但相关的 memo；两个字的中文词能被关键词搜到；重建索引后进度条走到 100%。

---

## 第 3 步：洞察

### 后端
- [x] 迁移：`insight_plans`（频率 / cron、时区、范围标签、分析窗口、视角、补充提示词、模型、投递方式、启用）、`insights`（报告内容、引用、状态、反馈）
- [x] Cron Trigger（每 15 分钟）检查到期计划（croner 解析）
- [x] Workflow：取窗口内 memo → 向量召回历史 → 聚类 → 分簇总结 → 汇总（AI SDK v7 `generateText` + `Output.object` + zod）→ 校验引用的 memo id → 存库
- [x] 模型接入：Workers AI（免费，默认 `@cf/qwen/qwen3-30b-a3b-fp8`）和 Claude（`@ai-sdk/anthropic`，用户自带 key），都经过 AI Gateway（`default`）
- [x] Claude API key 加密存储（密钥放 Worker secret）
- [x] 接口：计划增删改、立即生成 / 试运行、报告列表与详情、反馈、存为 memo
- [x] MCP 新增工具 `list_insights`

### 前端
- [x] 主侧边栏导航新增「洞察」，有未读报告时显示「1 新」
- [x] 洞察页顶部：当前计划摘要、「管理计划」「立即生成」
- [x] 洞察页左列：报告列表（含「生成中」状态）
- [x] 洞察页右侧：报告正文（摘要、反复出现的主题、新的连接、想做未做、值得追问的问题），每条结论带可点击的 memo 引用
- [x] 洞察页底部：「有用 / 没用」、「存为 memo」
- [x] 洞察页沿用完整主侧边栏（统计、热力图、标签都在）
- [x] 设置 › 洞察与搜索：计划列表（启用状态、编辑、新建）
- [x] 设置 › 洞察与搜索：计划编辑（频率、时间、范围、分析窗口、分析视角、补充提示词、模型、投递、试运行、保存）

**验收**：建一个「每天」计划并试运行，生成的报告里每条结论都能点到真实存在的 memo；点「存为 memo」后能在笔记里搜到。

---

## 第 4 步：微信正式接入

前提：第 0 步结论为可行。

### 后端
- [x] 迁移：`attachments`（memo_id、类型、R2 key、时长、尺寸、描述）、`wechat_bindings`（加密的 bot_token、bot_id、baseurl、游标、收录规则、状态）
- [x] R2 bucket `yaf-media` 绑定（2026-10-25 用户开通 R2）；附件读取接口（校验归属）
- [x] 绑定接口：取二维码、查询状态（处理 `scaned_but_redirect` 换域名、`need_verifycode` 提交验证码）、解绑
- [x] `WechatBridge` Durable Object：alarm 循环 getupdates → 按消息 id 去重 → 处理 → 存游标
- [x] 文字 → memo（`source = wechat`；自动标签默认关闭，开启后追加用户配置的标签）
- [x] 图片：下载 → `@noble/ciphers` AES-128-ECB 解密 → 存 R2（开通后）→ 视觉模型 `mistral-small-3.1-24b` 生成描述（用于搜索和向量；未开通 R2 时只存描述）
- [x] 语音：正文用 `voice_item.text`；SILK 原文件存 R2；回放改为**浏览器端**用 `silk-wasm` 解码成 wav（Workers 上跑不了，见决策记录）
- [x] ~~语音转写兜底~~：实测微信会给转写，暂不需要；为空时正文留空，卡片上只显示播放按钮和「没有转写文字」（2026-10-26 起不再往正文写占位）。原计划：`voice_item.text` 为空时，先存「[语音] 转写中…」，后台用 `silk-wasm` 解码成 wav → Workers AI `@cf/openai/whisper-large-v3-turbo` 转写 → 更新正文、标签和向量（是否需要取决于第 0 步实测）
- [x] 合并连续消息（2 分钟内，默认关）
- [x] 收录后回复「已记录 · #标签」（在 24 小时 `context_token` 窗口内）
- [x] 适配层独立：协议失效时只影响微信功能，并在设置页显示错误状态

### 前端
- [x] 设置 › 微信连接：二维码（`qrcode` 库渲染）、扫码状态（等待 / 已扫码 / 需验证码 / 已过期）、过期倒计时 + 刷新、验证码输入
- [x] 绑定步骤说明、风险提示
- [x] 已连接状态 + 「解绑」（原型未画，需补设计）
- [x] 收录规则开关：语音保留原音频、收录后回复确认、合并连续消息；自动标签（默认关闭，可自定义标签）单独一张卡片
- [x] memo 卡片：来源图标（悬停显示「来自微信」）
- [x] memo 卡片：语音附件（点击播放时才加载解码器，显示时长和转写文字）
- [x] memo 卡片：图片附件（缩略图，点击放大）

**验收**：微信里分别发文字、图片、语音，yaf 里各出现一条 memo；语音能回放、文字能搜到；解绑后不再收录。

---

## 第 5 步：v0.2.1 小改动（已上线 2026-10-26）

- [x] 卡片内编辑：点编辑器外部时，没改就退出，改过就保存；正文清空且不允许为空时保持编辑态
- [x] 设备授权页：授权码放在提示和按钮之间的独立区块，大号等宽

---

## 第 6 步：v0.3 视图（Lens）+ 隐私内容

设计见 ROADMAP 第 10 节；原型见画布最下面一排。

### 后端
- [x] 迁移 0007：`memo_labels`、`memos.masked_content`、`memos.judged_rev`
- [x] `worker/lenses.ts`：视图定义（private、todo）和视图集版本
- [x] `worker/judge.ts`：一次 Clef 调用判定所有视图 → 写 `memo_labels`（不覆盖 source = user）；命中 private 时逐行遮挡 → `masked_content`
- [x] 写入 / 编辑后的顺序：judge → 再决定算向量（private 不算，并删除已有向量）；FTS 用遮挡文本
- [x] Cron：补判未判定或版本过期的 memo（每次有上限）；向量补算只处理已判定且非 private 的 memo
- [x] 处理规则：搜索（FTS + 子串兜底）用遮挡文本；相关笔记、洞察材料排除 private；列表 / 搜索返回遮挡文本 + `private` / `labels`
- [x] `GET /api/memos/:id/raw`（只接受网页会话）
- [x] `PUT /api/memos/:id/labels/:label`（`{ value: true | false }`，记为 source = user；改 private 时重算遮挡和向量）
- [x] 列表按视图筛选：`GET /api/memos?lens=todo`；`GET /api/lenses` 返回各视图条数
- [x] Token（CLI / API / MCP）：隐私和未判定的 memo 不可见
- [x] 导出：默认遮挡文本；网页导出可选「包含隐私原文」
- [ ] 实测（本地已过，线上待做）：线上全部 memo 判定一遍，确认隐私 memo 只有遮挡文本进了 FTS、没有向量

### 前端
- [x] 侧栏：顶部导航只留「全部笔记」「洞察」；新增「视图」分组（待办、隐私 + 条数）；底部账户菜单（主题、设置、导出 / 退出登录），去掉 admin 标记
- [x] 标签树展开图标放大（已改 CSS，随本步上线）
- [x] 视图页：`#lens=private` / `#lens=todo` 筛选，标题显示视图名
- [x] 卡片：「待办」标记（× = 不是待办）；灰区时底部「这是待办吗？是 / 不是」
- [x] 卡片：隐私标记 + 遮挡显示；「显示原文」取原文，按钮变「隐藏 · 30s」倒计时后自动隐藏
- [x] 卡片：遮完没有可搜文字时，显示「添加标题，方便搜索」输入框（保存 = 在正文第一行加上标题）
- [x] `···` 菜单：「标记为隐私 / 取消隐私」
- [x] 编辑隐私 memo 时先取原文
- [x] 导出弹窗：「包含隐私原文」勾选

**验收**：新写一条带密码的 memo，几秒后出现在「隐私」视图里，卡片只显示遮挡文本；用网站名能搜到、用密码搜不到；MCP 的 `search_memos` 搜不到它；「显示原文」30 秒后自动隐藏。写一条「周五前续费域名」出现在「待办」视图。

---

## 第 7 步：v0.4 侧栏 AI 用量圆环

- [ ] 用户创建只读分析 Token，`wrangler secret put CF_ANALYTICS_TOKEN`；配置账户 ID、套餐
- [ ] Cron 拉当天 neurons 用量（`aiInferenceAdaptiveGroups`），按 modelId 映射功能，存 D1
- [ ] `GET /api/usage/ai`（admin）
- [ ] 侧栏底部右侧圆环 + 悬停卡片（总量、构成条、重置时间、更新时间）；≥ 80% 变橙

---

## 原型和设计的不一致（按右侧处理，除非另有决定）

| 项 | 原型 | 处理 |
|---|---|---|
| MCP 工具名 | `get_insight` | 以 ROADMAP 为准：`list_insights`、`get_related` 等 |
| 检索融合 | 「关键词 0.4 / 语义 0.6」权重 | 用 RRF 按名次融合，界面显示「融合方式：RRF」 |
| 洞察投递 | 有「邮件」「微信推送」选项 | 第 3 步先只做站内；邮件（Cloudflare Email Service）、微信推送以后再加 |

## 待决定

- [x] 洞察默认模型：Workers AI（免费）；可在设置里填 Claude key 后按计划切换（2026-10-25）
- [x] 「账号与安全」页内容：修改密码 + 会话数 / 退出其他设备（2026-10-25）
- [ ] 网页编辑器是否支持上传图片？
- [x] 微信「已连接 / 解绑」界面：按现有设置页卡片风格直接实现（状态、Bot、连接时间、最近收到、错误信息、解绑）
- [x] CLI 的 npm 包名：`yaf-cli`（与 ROADMAP 一致，npm 上未被占用）
