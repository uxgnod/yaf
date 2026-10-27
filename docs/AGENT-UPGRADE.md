# Upgrade yaf with an AI agent

For a coding agent. The user says "upgrade yaf" or pastes: *Read docs/AGENT-UPGRADE.md in this repo and upgrade me to the latest release.* Talk to the user in their language.

**Promise this procedure keeps**: the live site keeps working at every step, and every step can be undone. It holds because of three release rules (see `docs/RELEASING.md`): migrations only add things; the previous version's code still runs on the new schema; a release never silently needs a new secret. If `CHANGELOG.md` says a release breaks one of these, it will say exactly what to do. Follow it, and do not improvise.

## 0. Where you are

```bash
git status --short                 # must be clean; if not, ask the user before touching anything
git branch --show-current          # should be `deploy`
git describe --tags --abbrev=0     # current version
```

- Not on `deploy`, or `wrangler.jsonc` has no `database_id` → the install is not in the expected shape. Run `npx wrangler d1 info yaf-db` for the id, create/checkout a `deploy` branch, put the id in `wrangler.jsonc`, commit. Never put it on `main`.
- Local changes you did not make → ask the user.

## 1. Plan: read before changing anything

```bash
git fetch --tags origin
CUR=$(git describe --tags --abbrev=0)
NEW=$(git tag --sort=-v:refname | head -1)
git log --oneline $CUR..$NEW | head -50
git diff --stat $CUR $NEW -- migrations wrangler.jsonc package.json
```

Read every `CHANGELOG.md` entry from `$CUR` (exclusive) to `$NEW`. Tell the user, in a few lines: what is new, which migrations will run, any new Cloudflare resource or secret, anything marked **Action required**. Ask them to confirm. If `$CUR == $NEW`, say so and stop.

Skipping versions is fine: migrations are numbered and applied in order. Exception: if an entry says "upgrade via vX.Y.Z first", do that first.

## 2. Create the safety net

```bash
npx wrangler d1 time-travel info yaf-db      # note the bookmark: this is the data restore point
npx wrangler deployments list | tail -20     # note the current version id: this is the code restore point
```

Show both to the user and keep them for the report. (`wrangler d1 export` does not work here because yaf uses an FTS5 virtual table; Time Travel keeps 30 days of history and is the supported backup.)

## 3. Merge the release

```bash
git merge $NEW
```

Conflicts are expected only in `wrangler.jsonc`, `package-lock.json`.

- `wrangler.jsonc`: take upstream's version of everything, but **keep the user's** `database_id`, and their `r2_buckets` choice, `routes`, `AI_GATEWAY_ID` if they changed it. Run `git diff $CUR HEAD -- wrangler.jsonc` afterwards: the only differences from upstream's file should be those.
- `package-lock.json`: take upstream's (`git checkout --theirs package-lock.json`), then `npm install` regenerates what is needed.
- Any other conflict means the user edited source files. Show it and ask.

```bash
npm ci
npm run typecheck
```

Both must pass before going on.

## 4. Provide what the new version needs, before it is deployed

From the CHANGELOG entries and the `wrangler.jsonc` diff:

- New Vectorize index → create it (same flags as AGENT-INSTALL.md step 5).
- New R2 bucket → only if the user wants it (R2 needs a payment method). Declined: remove that binding line on `deploy`.
- New secrets → `wrangler secret put` them. Optional ones: offer, don't force.
- A new binding with no matching resource would make the deploy fail, not corrupt anything. Still, create resources first.

## 5. Migrate, then deploy

```bash
npx wrangler d1 migrations list yaf-db --remote   # shows exactly what will run
npm run db:migrate:remote                          # additive schema changes; old code keeps working
npm run deploy                                     # preflight → build → deploy
```

`npm run deploy` stops by itself if migrations are pending or `database_id` is missing. Do not bypass it with `YAF_SKIP_PREFLIGHT` or a bare `wrangler deploy`.

## 6. Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<url>/api/auth/status    # 200
npx wrangler d1 migrations list yaf-db --remote                           # "No migrations to apply"
npx wrangler tail --format pretty                                         # watch ~20 s, then Ctrl+C: no repeated errors
```

Ask the user to open the site, log in, and look at their memos. For new features, point them to the CHANGELOG entry.

## 7. If something is wrong

Pick the smallest undo that fixes it:

1. **Bug in the new code, data fine** (most common): `npx wrangler rollback <version-id from step 2>`. Old code runs correctly on the new schema, so no data step is needed. Then tell the user and open an issue at https://github.com/uxgnod/yaf/issues with the error.
2. **Migration failed halfway**: D1 runs each migration file atomically, so the failed file left no change. Read the error, do not retry blindly; `npx wrangler d1 migrations list yaf-db --remote` shows the state. Roll the code back if it was already deployed (it was not, if you followed the order).
3. **Data damaged** (rare; migrations are additive): `npx wrangler d1 time-travel restore yaf-db --bookmark=<bookmark from step 2>`. This discards everything written after the bookmark, so confirm with the user first, and roll the code back too.

Never delete the D1 database, Vectorize index or R2 bucket to "start clean".

## Report to the user

Version before → after, migrations applied, the two restore points, what to try in the app. Leave the repo on the `deploy` branch with a clean tree.
