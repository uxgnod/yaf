// 洞察生成 Workflow：每一步单独重试；最终失败时把 insights 记录标成 failed。
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { checkReport, gatherMaterial, summarizeCluster, writeReport, type ClusterSummary, type PlanConfig } from "./insight-engine";

export interface InsightParams {
  insightId: string;
  userId: string;
  plan: PlanConfig;
  periodStart: number;
  periodEnd: number;
}

const RETRY = { retries: { limit: 2, delay: "15 seconds" as const, backoff: "exponential" as const }, timeout: "10 minutes" as const };

export class InsightWorkflow extends WorkflowEntrypoint<Env, InsightParams> {
  async run(event: Readonly<WorkflowEvent<InsightParams>>, step: WorkflowStep) {
    const { insightId, userId, plan, periodStart, periodEnd } = event.payload;
    try {
      const material = await step.do("gather", RETRY, () => gatherMaterial(this.env, userId, plan, periodStart, periodEnd));

      if (!material.window.length) {
        await step.do("save empty", () =>
          this.save(insightId, "这段时间没有新的 memo", {
            summary: "分析时段内没有符合范围的新 memo，这次没有生成洞察。",
            themes: [],
            connections: [],
            unfinished: [],
            questions: [],
            memos: {},
            stats: { window: 0, history: 0, clusters: 0, dropped: 0 },
          }, null),
        );
        return;
      }

      // Map：多于一个簇时，每个簇单独总结
      const summaries: ClusterSummary[] = [];
      if (material.clusters.length > 1) {
        for (const [i, refs] of material.clusters.entries()) {
          summaries.push(await step.do(`cluster ${i}`, RETRY, () => summarizeCluster(this.env, userId, plan, material, refs)));
        }
      }

      // Reduce：生成报告并校验引用
      const { report, model } = await step.do("report", RETRY, () =>
        writeReport(this.env, userId, plan, material, summaries, { start: periodStart, end: periodEnd }),
      );
      const content = checkReport(report, material, material.clusters.length);
      await step.do("save", () => this.save(insightId, report.title, content, model));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await step.do("mark failed", () =>
        this.env.DB.prepare("UPDATE insights SET status = 'failed', error = ?, completed_at = ? WHERE id = ?")
          .bind(message.slice(0, 500), Date.now(), insightId)
          .run()
          .then(() => undefined),
      );
    }
  }

  private async save(id: string, title: string, content: unknown, model: string | null) {
    const c = content as { stats: { window: number } };
    await this.env.DB.prepare(
      `UPDATE insights SET status = 'ready', title = ?, content = ?, memo_count = ?, model = COALESCE(?, model), completed_at = ?
        WHERE id = ?`,
    )
      .bind(title, JSON.stringify(content), c.stats.window, model, Date.now(), id)
      .run();
  }
}
