# Install yaf with an AI agent

This file is written for a coding agent (Claude Code, Codex, etc.). The user pastes something like:

> Read https://raw.githubusercontent.com/uxgnod/yaf/main/docs/AGENT-INSTALL.md and install yaf for me.

Talk to the user in their language. Run commands yourself; only ask the user to act where this file says **USER**. Do each step, check its result, and stop and explain if a check fails. Never print secrets back into the chat except where stated.

**Goal**: yaf running on the user's own Cloudflare account (one Worker + D1 + Vectorize + Workers AI), admin account created. Everything fits the free plan except R2 (optional).

## Rules that keep upgrades safe

1. Work on a branch named `deploy`, created from a release tag. `main` is upstream's; never commit personal values to it.
2. The only personal value in the repo is the D1 `database_id` in `wrangler.jsonc`. Secrets (`ENCRYPTION_KEY`, `SETUP_TOKEN`, …) live in Cloudflare, never in files that git tracks.
3. Do not run `wrangler deploy` directly. Use `npm run deploy`: it refuses to run without `database_id` (otherwise wrangler would create a second, empty database).

## 1. Check the environment

```bash
node -v        # need >= 20.19 (or >= 22.12)
git --version
npm -v
```

Missing Node → ask the user to install it (https://nodejs.org or `mise`/`nvm`), then continue. Do not install system software without asking.

## 2. Get the code at the latest release

```bash
git clone https://github.com/uxgnod/yaf.git && cd yaf
TAG=$(git tag --sort=-v:refname | head -1)   # latest release
git checkout -b deploy "$TAG"
npm ci
```

Tell the user which version you are installing and read its entry in `CHANGELOG.md`.

## 3. Cloudflare account and login

```bash
npx wrangler whoami
```

- Logged in → note the account name. If several accounts are listed, ask the user which one to use and set `CLOUDFLARE_ACCOUNT_ID` for the rest of the session.
- Not logged in → **USER**: if they have no account, sign up at https://dash.cloudflare.com/sign-up (free, email only). Then run `npx wrangler login`; a browser opens and the user clicks **Allow**.
- No browser available (SSH, container) → **USER** creates an API token at https://dash.cloudflare.com/profile/api-tokens with the *Edit Cloudflare Workers* template, and exports it as `CLOUDFLARE_API_TOKEN`. Add the permissions *D1 Edit* and *Vectorize Edit* (+ *Workers R2 Storage Edit* if using R2) to that template.

First deploy also needs a `workers.dev` subdomain. If wrangler asks for one in step 8, let the user pick a name.

## 4. Create the database

```bash
npx wrangler d1 list                      # does yaf-db already exist?
npx wrangler d1 create yaf-db             # skip if it exists and the user wants to reuse it
```

Copy the returned `database_id` into the `d1_databases` entry of `wrangler.jsonc`, directly under `"database_name"`:

```jsonc
"database_id": "<id>",
```

```bash
git commit -am "chore: bind my D1 database"   # on the deploy branch
```

If `yaf-db` already exists, ask the user whether it is theirs from an earlier install. If so, this is an **upgrade**, not an install: stop and follow `docs/AGENT-UPGRADE.md` instead.

## 5. Create Vectorize (semantic search)

```bash
npx wrangler vectorize create yaf-memos --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index yaf-memos --propertyName=userId --type=string
```

Dimensions and metric cannot be changed later. Do not alter them.

## 6. R2 (optional: WeChat images and voice)

```bash
npx wrangler r2 bucket list
```

- Works → `npx wrangler r2 bucket create yaf-media`.
- Fails with "enable R2" (code 10042) → ask the user. R2 has a free tier but needs a payment method on file; they can enable it at https://dash.cloudflare.com/?to=/:account/r2/overview. If they decline or want to skip: delete the `"r2_buckets": [...]` line from `wrangler.jsonc`, `git commit -am "chore: no R2"`. WeChat text capture still works; images and voice are recorded without the original file. They can add R2 later (see upgrade doc).

## 7. Secrets

Generate them locally and pipe them in so they never land in files or shell history:

```bash
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY
SETUP=$(openssl rand -hex 12); printf '%s' "$SETUP" | npx wrangler secret put SETUP_TOKEN; echo "SETUP_TOKEN (give this to the user once): $SETUP"
```

- `ENCRYPTION_KEY` encrypts the user's Claude API key and WeChat token. **Losing or rotating it makes those unreadable.** Tell the user to keep it only in Cloudflare.
- `SETUP_TOKEN` stops a stranger from creating the admin account first. Show it to the user once; they need it on the registration page.

`wrangler secret put` before the first deploy may ask to create the Worker. Answer yes.

## 8. Migrate and deploy

```bash
npm run db:migrate:remote      # answer y
npm run deploy                 # runs preflight, builds, deploys
```

The output ends with the Worker URL (`https://yaf.<subdomain>.workers.dev`). If the deploy fails on AI Gateway, set `"AI_GATEWAY_ID": ""` in `wrangler.jsonc` (calls then go direct) and commit to `deploy`.

## 9. Create the admin account

**USER**: open the URL, enter email, password and the `SETUP_TOKEN` from step 7. That creates the admin; setup is then permanently closed.

Verify:

```bash
curl -s https://<url>/api/auth/status      # {"needsSetup":false,...} after registration
```

## 10. Optional follow-ups (offer, don't force)

- **Claude key for insights**: in the app, Settings › AI. (Default is free Workers AI.)
- **AI usage ring**: README › "AI usage ring". It needs a read-only API token; give the user this pre-filled link: https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%5D&name=yaf-analytics . Then `wrangler secret put CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`, optionally `AI_PLAN` (`paid`), and `npm run deploy`.
- **CLI / MCP**: Settings › API Token, or `npm install -g yaf-cli && yaf login --host https://<url>`.
- **Custom domain**: add a `routes` entry in `wrangler.jsonc` on the `deploy` branch.

## Final report to the user

Say: installed version, Worker URL, which optional parts are on (R2, usage ring), and that updates are done by asking the agent to follow `docs/AGENT-UPGRADE.md`. Remind them to keep the repo folder (the `deploy` branch holds their database id).
