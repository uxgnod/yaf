import { Hono } from "hono";
import type { AppEnv } from "./env";
import { auth } from "./auth";
import { memos } from "./memos";

const app = new Hono<AppEnv>().basePath("/api");

app.route("/auth", auth);
app.route("/", memos);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "服务器错误" }, 500);
});
app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default app;
