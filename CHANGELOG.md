# Changelog

Each entry lists what an upgrade needs. Upgrade procedure: [docs/AGENT-UPGRADE.md](docs/AGENT-UPGRADE.md).

Legend: **Migrations** = D1 files applied by `npm run db:migrate:remote`. **Resources** = Cloudflare things to create before deploying. **Secrets** = `wrangler secret put`. **Action required** = anything else.

## v0.4.1

> **Recommended upgrade before 2026-11-20**: Cloudflare is retiring `@cf/qwen/qwen3-30b-a3b-fp8` (the previous default Workers AI insight model) on **November 20, 2026**, after which requests to it fail with `HTTP 410 Gone` (`5028`).

- Selectable Workers AI insight model (Settings › Insights & Search › Insight model): pick from active Free Plan models (`@cf/qwen/qwen3.8-27b`, `@cf/google/gemma-4-26b-a4b-it`, `@cf/zai-org/glm-4.7-flash`, `@cf/moonshotai/kimi-k2.5`, etc.) or Paid Plan models (`@cf/deepseek-ai/deepseek-v4.1-flash-1017`, `@cf/zai-org/glm-5.3`), and toggle thinking mode (`enable_thinking`) when supported. New installs default to `@cf/qwen/qwen3.8-27b` (thinking off); existing installs with active insight plans keep their current setting and show a deprecation warning until switched.
- Insights now write Markdown (quotes, lists, inline code), recall up to 20 related history memos per note, and receive computed tag counts and open tasks as data facts.
- Quotes (`>`) render as excerpts: a tinted block with a hanging quote mark and serif text; a last line starting with `— ` or `——` becomes the source line at the bottom right. `#tags` in a memo body are only linked when they are real tags of that memo.
- Migrations: none
- Resources: none
- Secrets: none
- **Action required** (existing Insights users): after deploying `v0.4.1`, open **Settings › 洞察与搜索 › 洞察模型**, click **更换模型**, and switch from `@cf/qwen/qwen3-30b-a3b-fp8` to `@cf/qwen/qwen3.8-27b` or `@cf/google/gemma-4-26b-a4b-it`.

## v0.4.0

- Sidebar AI usage ring: today's Workers AI neurons for the account, admin only. Hidden until configured.
- WeChat image descriptions use `@cf/qwen/qwen3.8-27b` (thinking off). Descriptions already stored are not recomputed.
- `npm run deploy` now runs a preflight check (needs `database_id`, no pending migrations). `main` no longer contains a `database_id`; keep it on your own `deploy` branch.
- Migrations: none
- Resources: none
- Secrets (all optional, only for the usage ring): `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`, `AI_PLAN` (`paid` if on a paid plan)
- Action required: if you previously deployed from a checkout that had `database_id` committed on `main`, move it to a `deploy` branch (see upgrade doc step 0). `AI_PLAN` is no longer in `wrangler.jsonc` `vars`; set it as a secret if you are on a paid plan.

## v0.3.0

- Lenses (todo / private) judged by Workers AI Clef; private memos are masked for search, tokens and export.
- Migrations: `0007_lenses.sql` (adds `memo_labels`; adds columns to `memos`, all with defaults)
- Resources / Secrets: none
- Existing memos are judged in the background after deploy (the 15-minute cron). Until judged they are not visible to API tokens (CLI / API / MCP).

## v0.2.1

- Card editor closes on outside click; clearer device code on the CLI approval page.
- Migrations / Resources / Secrets: none

## v0.2.0

AI-native release: hybrid search, related notes, insights, MCP, API tokens, CLI, WeChat capture. Licensed AGPL-3.0.

- Migrations: `0002`–`0006` (new tables, FTS5 index, new columns with defaults)
- Resources (all new since v0.1.0):
  - Vectorize index `yaf-memos` (1024 dims, cosine) + metadata index on `userId`
  - Workers AI binding, two Workflows, one Durable Object class, a cron trigger (all declared in `wrangler.jsonc`; created on deploy)
  - R2 bucket `yaf-media` — optional; remove `r2_buckets` from `wrangler.jsonc` if you do not enable R2
- Secrets: `ENCRYPTION_KEY` (required: 32 random bytes, base64)
- Action required: after the first deploy, open Settings › search index and run the backfill, or wait for the cron to embed existing memos.

## v0.1.0

The original simple version: memos, Markdown, tags, keyword search, export, themes, heatmap. D1 only.

- Migrations: `0001_init.sql`
