import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { auth } from "./auth";
import { memos } from "./memos";
import { tokens } from "./tokens";
import { handleMcp } from "./mcp";
import { backfillAll } from "./search";
import { insights, runDuePlans } from "./insights";
import { wechat } from "./wechat/routes";
import { autoTags } from "./auto-tags";

const app = new Hono<AppEnv>().basePath("/api");

app.route("/auth", auth);
app.route("/", tokens);
app.route("/", insights);
app.route("/", wechat);
app.route("/", autoTags);
app.route("/", memos);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "服务器错误" }, 500);
});
app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/mcp") return handleMcp(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.allSettled([runDuePlans(env), backfillAll(env)]));
  },
} satisfies ExportedHandler<Env>;

export { IndexWorkflow } from "./index-workflow";
export { InsightWorkflow } from "./insight-workflow";
export { WechatBridge } from "./wechat/bridge";
