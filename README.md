# yaf — Yet Another Flomo

一个跑在 Cloudflare 免费额度上的 flomo 复刻。

- **运行时**：Cloudflare Workers（Hono 路由）+ Static Assets（React SPA），同一个 Worker 部署
- **存储**：D1（SQLite），Vectorize（向量）
- **AI**：Workers AI（`@cf/baai/bge-m3` 向量）；Workflows 做存量补算，Cron 每 15 分钟自动补算
- **前端**：React + Vite（`@cloudflare/vite-plugin`，本地开发即在 workerd 中运行）
- **Markdown**：marked（GFM）+ DOMPurify 净化

## 功能

- 写 / 编辑 / 删除 memo，支持 Markdown（标题、列表、任务列表、引用、代码、表格、链接…）
- 自动从内容中提取 `#标签`，支持层级 `#a/b/c`；代码块和行内代码中的 `#` 不算标签；`# 标题` 不算标签
- 按标签筛选（父标签包含所有子标签）
- 混合检索：关键词（D1 FTS5 + 中文切词）+ 语义（Workers AI `bge-m3` + Vectorize），RRF 融合；命中标记、关键词高亮、⌘K；每条 memo 可查看「相关笔记」
- 邮箱 + 密码登录；首次启动没有用户时进入「创建管理员」页面
- 导出 Markdown / JSON，可按标签导出（便于交给 AI 分析）
- 亮色 / 暗色 / 跟随系统 三种主题（左上角按钮切换）
- 侧边栏统计和最近 16 周的热力图
- API Token（按权限 scope 授权，可撤销、可设过期）、MCP 服务器（`/mcp`）、命令行工具 `yaf`
- 设置页：账号与安全（修改密码、退出其他设备）、API Token

## 本地开发

```bash
npm install
npm run db:migrate:local   # 初始化本地 D1
npm run dev                # http://localhost:5173
```

第一次打开会进入「创建管理员账号」页面。

## 部署到 Cloudflare

```bash
npx wrangler login
npx wrangler d1 create yaf-db          # 把返回的 database_id 填到 wrangler.jsonc
npx wrangler vectorize create yaf-memos --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index yaf-memos --propertyName=userId --type=string
npm run db:migrate:remote
npx wrangler secret put SETUP_TOKEN    # 推荐：防止部署后被他人抢先注册 admin
npm run deploy
```

设置了 `SETUP_TOKEN` 后，初始化页面需要填写这个口令。admin 创建完成后，`/api/auth/setup` 将永久失效。

## MCP

在 设置 › API Token 新建 Token 后：

```bash
claude mcp add --transport http yaf https://<你的域名>/mcp --header "Authorization: Bearer <Token>"
```

工具：`search_memos`（混合检索）、`get_memo`、`add_memo`、`get_related`、`list_tags`。

## CLI

```bash
npm install -g yaf-cli          # 或在仓库里：npm run cli:build && node packages/cli/dist/index.js
yaf login --host https://<你的域名>   # 浏览器确认后自动保存 Token 到 ~/.config/yaf/
echo "想法 #inbox" | yaf add
yaf search 关键词 --tag inbox
yaf tags
yaf export --tag inbox --format md -o inbox.md
```

## 结构

```
worker/          # API（Hono）
  index.ts       # 入口：/api/* 交给 Hono，/mcp 交给 MCP handler
  auth.ts        # 初始化 admin、登录、会话、修改密码；鉴权中间件（Cookie 或 Bearer Token + scope）
  memos.ts       # memo REST 接口、统计、导出
  memo-service.ts# memo 读写逻辑（REST 和 MCP 共用）
  tokens.ts      # API Token 管理、设备码登录
  mcp.ts         # MCP 服务器
  search.ts      # 混合检索、相关笔记、索引状态
  index-workflow.ts # 补算向量的 Workflow
shared/segment.ts  # 中文切词（Intl.Segmenter，前后端共用）
packages/cli/    # yaf 命令行工具
shared/tags.ts # 标签提取（前后端共用）
src/           # React 前端
migrations/    # D1 schema
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/status` | 是否需要初始化 |
| POST | `/api/auth/setup` | 创建 admin（仅在没有用户时可用） |
| POST | `/api/auth/login` / `/api/auth/logout` | 登录 / 登出 |
| GET | `/api/auth/me` | 当前用户 |
| GET | `/api/memos?q=&tag=&cursor=&mode=&sort=` | 列表 / 按标签筛选（游标分页）；有 `q` 时为混合检索，`mode=hybrid\|keyword\|semantic`，`sort=relevance\|time`，返回 `match` 和 `stats` |
| GET | `/api/memos/:id/related` | 相关笔记 |
| GET / POST | `/api/search/status`、`/api/search/reindex` | 语义索引状态 / 补算（`{full:true}` 重建） |
| POST / PATCH / DELETE | `/api/memos[/:id]` | 增 / 改 / 删 |
| GET | `/api/tags` | 标签及计数 |
| GET | `/api/stats?tz=` | 统计与热力图 |
| GET | `/api/export?tag=&format=md\|json` | 导出 |
| GET | `/api/memos/:id` | 单条 memo |
| POST | `/api/auth/password` | 修改密码（仅网页会话） |
| GET / POST | `/api/auth/sessions`、`/api/auth/sessions/revoke-others` | 会话数 / 退出其他设备 |
| GET / POST / DELETE | `/api/tokens[/:id]` | API Token 列表 / 新建（明文只返回一次）/ 撤销（仅网页会话） |
| POST | `/api/device/code`、`/api/device/token` | CLI 设备码登录：发起 / 轮询 |
| GET / POST | `/api/device/:userCode` | 网页端查看 / 批准设备登录 |
| POST | `/mcp` | MCP（Streamable HTTP），需 Bearer Token |

除 Token 管理、修改密码外，`/api/*` 也接受 `Authorization: Bearer yaf_pat_…`，按 scope 校验：`memos:read`、`memos:write`、`export`、`insights:read`。
