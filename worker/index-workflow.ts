// 存量 memo 分批补算向量（也用于「重建索引」）。每批一个 step，失败自动重试。
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { indexMemos } from "./search";

const BATCH = 50;
const MAX_BATCHES = 400; // 上限 2 万条，防止异常时无限循环

export class IndexWorkflow extends WorkflowEntrypoint<Env, { userId: string }> {
  async run(event: Readonly<WorkflowEvent<{ userId: string }>>, step: WorkflowStep) {
    const { userId } = event.payload;
    let done = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await step.do(
        `batch ${i}`,
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "5 minutes" },
        async () => {
          const { results } = await this.env.DB.prepare(
            `SELECT id, user_id, content, created_at FROM memos
              WHERE user_id = ? AND vector_hash IS NULL AND judged_rev IS NOT NULL AND is_private = 0
              ORDER BY created_at LIMIT ?`,
          )
            .bind(userId, BATCH)
            .all<{ id: string; user_id: string; content: string; created_at: number }>();
          await indexMemos(this.env, results);
          return results.length;
        },
      );
      done += n;
      if (n < BATCH) break;
    }
    return { indexed: done };
  }
}
