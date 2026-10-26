#!/usr/bin/env node
// yaf CLI：yaf login / add / search / tags / export / whoami / logout
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { exec } from "node:child_process";
import { createInterface } from "node:readline/promises";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "yaf");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  host: string;
  token?: string;
}

interface Memo {
  id: string;
  content: string;
  createdAt: number;
  tags: string[];
}

const HELP = `yaf — 在终端里记录和搜索 memo

用法：
  yaf login [--host <url>]         打开浏览器授权，保存 Token；第一次登录需填写服务地址
  yaf add [内容]                    新增 memo；不带内容时读取标准输入（支持管道）
  yaf search [关键词] [--tag <t>]   搜索，可加 --limit <n>、--json
  yaf tags                          列出标签和数量
  yaf export [--tag <t>] [--format md|json] [-o <文件>]
  yaf whoami                        查看当前登录
  yaf logout                        删除本地保存的 Token

环境变量：YAF_HOST、YAF_TOKEN 可覆盖配置文件（${CONFIG_FILE}）。`;

async function loadConfig(): Promise<Config> {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  } catch {
    /* 没有配置文件 */
  }
  return {
    host: normalizeHost(process.env.YAF_HOST || file.host || ""),
    token: process.env.YAF_TOKEN || file.token,
  };
}

async function saveConfig(cfg: Config) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

function die(msg: string): never {
  console.error(`yaf: ${msg}`);
  process.exit(1);
}

/** 补全协议、去掉末尾斜杠；空字符串表示未设置 */
function normalizeHost(raw: string): string {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return "";
  // 没写协议时默认 https；本机地址默认 http（本地开发）
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(v);
  const withScheme = /^https?:\/\//i.test(v) ? v : `${local ? "http" : "https"}://${v}`;
  try {
    const u = new URL(withScheme);
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    die(`服务地址无效：${raw}`);
  }
}

/** 第一次登录且没给 --host 时，在终端里询问服务地址 */
async function askHost(): Promise<string> {
  if (!process.stdin.isTTY) die("未设置服务地址，请运行 yaf login --host <你的 yaf 地址>");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("yaf 服务地址（例如 https://yaf.example.workers.dev）：");
    const host = normalizeHost(answer);
    if (!host) die("未填写服务地址");
    return host;
  } finally {
    rl.close();
  }
}

async function api<T>(cfg: Config, path: string, init: RequestInit = {}): Promise<T> {
  if (!cfg.host) die("未设置服务地址，请先运行 yaf login --host <你的 yaf 地址>");
  if (!cfg.token) die("未登录，请先运行 yaf login");
  const res = await fetch(cfg.host + "/api" + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      "X-Yaf-Source": "cli",
      ...init.headers,
    },
  }).catch(() => die(`无法连接 ${cfg.host}，请检查网络或重新运行 yaf login --host <地址>`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) die(`${data.error ?? "未授权"}，请重新运行 yaf login`);
    die(data.error ?? `${res.status} ${res.statusText}`);
  }
  return res as unknown as T;
}

async function json<T>(cfg: Config, path: string, init?: RequestInit): Promise<T> {
  const res = await api<Response>(cfg, path, init);
  return (await res.json()) as T;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
  exec(`${cmd} "${url}"`, () => {
    /* 打不开就让用户手动访问 */
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function printMemo(m: Memo) {
  console.log(dim(`${formatTime(m.createdAt)}  ${m.id.slice(0, 8)}`));
  console.log(m.content);
  console.log();
}

// ---------- 命令 ----------

async function login(args: string[]) {
  const { values } = parseArgs({ args, options: { host: { type: "string" } } });
  const cfg = await loadConfig();
  const host = normalizeHost(values.host ?? "") || cfg.host || (await askHost());
  const res = await fetch(`${host}/api/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: `CLI · ${hostname()}` }),
  }).catch(() => die(`无法连接 ${host}，请检查地址是否正确`));
  if (!res.ok) die(`无法连接 ${host}（${res.status}），请检查地址是否正确`);
  const d = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  };
  console.log(`请在浏览器中确认登录，代码：${d.user_code}`);
  console.log(d.verification_uri_complete);
  openBrowser(d.verification_uri_complete);

  const deadline = Date.now() + d.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(d.interval * 1000);
    const r = await fetch(`${host}/api/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: d.device_code }),
    });
    const body = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (body.access_token) {
      await saveConfig({ host, token: body.access_token });
      console.log(`已登录 ${host}，Token 保存在 ${CONFIG_FILE}`);
      return;
    }
    if (body.error === "access_denied") die("登录请求被拒绝");
    if (body.error === "expired_token") die("代码已过期，请重新运行 yaf login");
  }
  die("等待超时，请重新运行 yaf login");
}

async function add(args: string[]) {
  const cfg = await loadConfig();
  const content = (args.join(" ") || (await readStdin())).trim();
  if (!content) die("内容为空。用法：yaf add <内容> 或 echo 内容 | yaf add");
  const { memo } = await json<{ memo: Memo }>(cfg, "/memos", { method: "POST", body: JSON.stringify({ content }) });
  console.log(`已记录 ${memo.id.slice(0, 8)}${memo.tags.length ? " · " + memo.tags.map((t) => "#" + t).join(" ") : ""}`);
}

async function search(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { tag: { type: "string", short: "t" }, limit: { type: "string", short: "n" }, json: { type: "boolean" } },
  });
  const cfg = await loadConfig();
  const qs = new URLSearchParams();
  if (positionals.length) qs.set("q", positionals.join(" "));
  if (values.tag) qs.set("tag", values.tag.replace(/^#/, ""));
  qs.set("limit", values.limit || "20");
  const r = await json<{ memos: Memo[]; nextCursor: string | null }>(cfg, `/memos?${qs}`);
  if (values.json) return console.log(JSON.stringify(r.memos, null, 2));
  if (!r.memos.length) return console.log("没有匹配的 memo");
  for (const m of r.memos) printMemo(m);
  if (r.nextCursor) console.log(dim("（还有更多，可用 --limit 增加条数）"));
}

async function tags() {
  const cfg = await loadConfig();
  const r = await json<{ tags: { tag: string; count: number }[] }>(cfg, "/tags");
  if (!r.tags.length) return console.log("还没有标签");
  for (const t of r.tags) console.log(`#${t.tag}  ${dim(String(t.count))}`);
}

async function exportCmd(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { tag: { type: "string", short: "t" }, format: { type: "string", short: "f" }, output: { type: "string", short: "o" } },
  });
  const cfg = await loadConfig();
  const format = values.format === "json" ? "json" : "md";
  const qs = new URLSearchParams({ format });
  if (values.tag) qs.set("tag", values.tag.replace(/^#/, ""));
  const res = await api<Response>(cfg, `/export?${qs}`);
  const body = await res.text();
  if (values.output) {
    await writeFile(values.output, body);
    console.error(`已导出到 ${values.output}`);
  } else process.stdout.write(body);
}

async function whoami() {
  const cfg = await loadConfig();
  const { user } = await json<{ user: { email: string; name: string | null } }>(cfg, "/auth/me");
  console.log(`${user.name ? user.name + " " : ""}<${user.email}> @ ${cfg.host}`);
}

async function logout() {
  await rm(CONFIG_FILE, { force: true });
  console.log("已删除本地 Token。如需让它彻底失效，请在 设置 › API Token 中撤销。");
}

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = {
  login,
  add,
  search,
  tags,
  export: exportCmd,
  whoami,
  logout,
};

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") console.log(HELP);
else if (cmd === "--version" || cmd === "-v") console.log("0.1.0");
else if (!commands[cmd]) die(`未知命令 ${cmd}\n\n${HELP}`);
else
  commands[cmd](rest).catch((e) => die(e instanceof Error ? e.message : String(e)));
