# yaf-cli

[English](#english) · [中文](#中文)

Command-line client for [yaf](https://github.com/uxgnod/yaf), a self-hosted, flomo-style memo app that runs on Cloudflare Workers.

yaf 的命令行客户端。yaf 是一个跑在 Cloudflare Workers 上、可自部署的 flomo 风格笔记应用。

---

## English

> You need your own yaf deployment. This CLI has no built-in server address. See the [yaf repository](https://github.com/uxgnod/yaf) to deploy one.

### Install

```sh
npm install -g yaf-cli
```

Requires Node.js 20 or later. Once installed, the command is `yaf`.

### Quick start

```sh
yaf login --host https://yaf.example.com   # confirm in the browser; asks for the address if --host is omitted
yaf add "Weekly reports could be generated from memos #idea"
echo "Notes from a pipe #inbox" | yaf add
yaf search "weekly report"
```

### Commands

| Command | Description |
| --- | --- |
| `yaf login [--host <url>]` | Sign in through the browser (device code). The address is saved after the first login. |
| `yaf add [text]` | Create a memo. Reads stdin when no text is given. `#tags` (including `#a/b`) are recognized. |
| `yaf search [query] [-t <tag>] [-n <limit>] [--json]` | Search memos (hybrid keyword + semantic). Default limit is 20. |
| `yaf tags` | List tags with counts. |
| `yaf export [-t <tag>] [-f md\|json] [-o <file>]` | Export memos as Markdown (default) or JSON, to stdout or a file. |
| `yaf whoami` | Show the signed-in account and server. |
| `yaf logout` | Delete the locally saved token. |

### Configuration

- The server address and token are stored in `~/.config/yaf/config.json` (file mode `600`). `XDG_CONFIG_HOME` is respected.
- `YAF_HOST` and `YAF_TOKEN` override the config file, which is useful for scripts and CI. Create a token in **Settings › API Token** of your yaf instance.
- `yaf logout` only deletes the local copy. To revoke a token, use **Settings › API Token**.
- Memos created by the CLI are marked with a CLI source icon. To tag them automatically, turn on **Settings › API Token › Auto tags › CLI**.

Messages printed by the CLI are currently in Chinese.

---

## 中文

> 需要先有自己部署的 yaf 服务，CLI 不内置任何服务地址。部署方法见 [yaf 仓库](https://github.com/uxgnod/yaf)。

### 安装

```sh
npm install -g yaf-cli
```

需要 Node.js 20 或更高版本。安装后使用的命令是 `yaf`。

### 快速开始

```sh
yaf login --host https://yaf.example.com   # 在浏览器里确认；不带 --host 时会询问地址
yaf add "周报可以直接从 memo 里生成 #想法"
echo "从管道写入 #inbox" | yaf add
yaf search 周报
```

### 命令

| 命令 | 说明 |
| --- | --- |
| `yaf login [--host <url>]` | 在浏览器里授权登录（设备码）。地址在第一次登录后保存。 |
| `yaf add [内容]` | 新增 memo；不带内容时读取标准输入。支持 `#标签` 和层级 `#a/b`。 |
| `yaf search [关键词] [-t <标签>] [-n <条数>] [--json]` | 搜索 memo（关键词 + 语义混合检索），默认 20 条。 |
| `yaf tags` | 列出标签和数量。 |
| `yaf export [-t <标签>] [-f md\|json] [-o <文件>]` | 导出为 Markdown（默认）或 JSON，输出到终端或文件。 |
| `yaf whoami` | 查看当前登录的账号和服务地址。 |
| `yaf logout` | 删除本地保存的 Token。 |

### 配置

- 服务地址和 Token 保存在 `~/.config/yaf/config.json`（权限 `600`），支持 `XDG_CONFIG_HOME`。
- 环境变量 `YAF_HOST`、`YAF_TOKEN` 优先于配置文件，适合脚本和 CI。Token 在 yaf 的「设置 › API Token」里创建。
- `yaf logout` 只删除本地副本。要让 Token 失效，请在「设置 › API Token」里撤销。
- CLI 写入的 memo 会显示 CLI 来源图标。想自动加标签，在「设置 › API Token › 自动标签 › CLI」里开启。

## License

`yaf-cli` is licensed under the [MIT License](https://github.com/uxgnod/yaf/blob/main/packages/cli/LICENSE). The yaf server it talks to is licensed separately under [AGPL-3.0](https://github.com/uxgnod/yaf/blob/main/LICENSE).

`yaf-cli` 以 [MIT](https://github.com/uxgnod/yaf/blob/main/packages/cli/LICENSE) 授权；它所连接的 yaf 服务端另以 [AGPL-3.0](https://github.com/uxgnod/yaf/blob/main/LICENSE) 授权。
