// 部署前检查，由 `npm run deploy` 调用。目的：升级时不会让线上出问题。
// 1. wrangler.jsonc 必须写了 database_id：没写的话 wrangler 会新建一个空库，线上数据看起来「消失」。
// 2. 线上不能有未应用的迁移：新代码默认表结构已是最新。
// 设置 YAF_SKIP_PREFLIGHT=1 可跳过（不建议）。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.env.YAF_SKIP_PREFLIGHT === "1") process.exit(0);

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const dbName = config.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];
const dbId = config.match(/^\s*"database_id"\s*:\s*"([0-9a-f-]{36})"/m)?.[1];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!dbName) fail("wrangler.jsonc 里没有找到 d1_databases.database_name。");
if (!dbId) {
  fail(
    "wrangler.jsonc 的 D1 配置缺少 database_id。\n" +
      "  继续部署会让 wrangler 新建一个空库，原有数据不会被删除，但站点会读不到。\n" +
      "  新安装：按 docs/AGENT-INSTALL.md 创建数据库并填入 id。\n" +
      "  已有安装：运行 `npx wrangler d1 info " + dbName + "` 取回 id，写进你的 deploy 分支，不要写在 main 上。\n" +
      "  见 docs/AGENT-UPGRADE.md「本地改动放在 deploy 分支」。"
  );
}

const r = spawnSync("npx", ["wrangler", "d1", "migrations", "list", dbName, "--remote"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const out = `${r.stdout}${r.stderr}`;
if (r.status !== 0) fail(`读取线上迁移状态失败（未登录或网络问题？）：\n${out.trim()}`);
if (!out.includes("No migrations to apply")) {
  fail(
    "线上数据库有未应用的迁移。部署前请先记录 Time Travel 书签，再应用迁移：\n" +
      `  npx wrangler d1 time-travel info ${dbName}\n` +
      "  npm run db:migrate:remote\n" +
      "  然后重新 npm run deploy。\n" +
      "  见 docs/AGENT-UPGRADE.md。"
  );
}
console.log(`✔ preflight: ${dbName} (${dbId.slice(0, 8)}…) 迁移已是最新`);
