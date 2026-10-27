# Changelog

Each entry lists what an upgrade needs. Upgrade procedure: [docs/AGENT-UPGRADE.md](docs/AGENT-UPGRADE.md).

Legend: **Migrations** = D1 files applied by `npm run db:migrate:remote`. **Resources** = Cloudflare things to create before deploying. **Secrets** = `wrangler secret put`. **Action required** = anything else.

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
