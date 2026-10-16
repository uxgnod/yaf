# yaf — Yet Another Flomo

一个跑在 Cloudflare 免费额度上的 flomo 复刻。

- **运行时**：Cloudflare Workers（Hono 路由）+ Static Assets（React SPA），同一个 Worker 部署
- **存储**：D1（SQLite）
- **前端**：React + Vite（`@cloudflare/vite-plugin`，本地开发即在 workerd 中运行）
- **Markdown**：marked（GFM）+ DOMPurify 净化

## 功能

- 写 / 编辑 / 删除 memo，支持 Markdown（标题、列表、任务列表、引用、代码、表格、链接…）
- 自动从内容中提取 `#标签`，支持层级 `#a/b/c`；代码块和行内代码中的 `#` 不算标签；`# 标题` 不算标签
- 按标签筛选（父标签包含所有子标签），关键词搜索（空格分隔，多个词需全部命中）
- 邮箱 + 密码登录；首次启动没有用户时进入「创建管理员」页面
- 导出 Markdown / JSON，可按标签导出（便于交给 AI 分析）
- 亮色 / 暗色 / 跟随系统 三种主题（左上角按钮切换）
- 侧边栏统计和最近 16 周的热力图

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
npm run db:migrate:remote
npx wrangler secret put SETUP_TOKEN    # 推荐：防止部署后被他人抢先注册 admin
npm run deploy
```

设置了 `SETUP_TOKEN` 后，初始化页面需要填写这个口令。admin 创建完成后，`/api/auth/setup` 将永久失效。

## 结构

```
worker/        # API（Hono）
  auth.ts      # 初始化 admin、登录、登出、会话（PBKDF2 密码哈希，会话 cookie 只在库中存哈希）
  memos.ts     # memo CRUD、标签、搜索、统计、导出
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
| GET | `/api/memos?q=&tag=&cursor=` | 列表 / 搜索 / 按标签筛选，游标分页 |
| POST / PATCH / DELETE | `/api/memos[/:id]` | 增 / 改 / 删 |
| GET | `/api/tags` | 标签及计数 |
| GET | `/api/stats?tz=` | 统计与热力图 |
| GET | `/api/export?tag=&format=md\|json` | 导出 |
