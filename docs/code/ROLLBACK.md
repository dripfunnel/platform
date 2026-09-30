# Rollback: prod

## API Worker — promoting a deploy

`prod.yml` only uploads a Worker version (`wrangler versions upload`); it does not put it live
and does not deploy the SPAs. The run summary prints the version ID. To go live, run the
**promote** workflow (`workflow_dispatch` on `promote.yml`) with that `version_id` and the
commit's `commit_sha`. It promotes the Worker to 100%, health-checks the live prod host, and —
only if that succeeds — builds and deploys all three SPAs from that same commit. If you'd rather
promote by hand instead (from `apps/api`, with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for
the prod account):

```
pnpm exec wrangler versions deploy <version-id>@100 --env prod -y
```

Nothing serves the new code until this is run — a failed or skipped promotion just leaves the
previous version live. If you promote by hand, deploy the SPAs by hand too (see below) — skipping
`promote.yml` means nothing enforces that they come from the same commit as the Worker.

## API Worker — rolling back

The previous version is still stored by Cloudflare — no rebuild needed.

```
pnpm exec wrangler versions list --env prod
pnpm exec wrangler versions deploy <previous-version-id>@100 --env prod -y
```

This is safe because migrations are required to be backward-compatible with the previously
running version (ARCHITECTURE.md §6) — the old Worker code keeps working against the current
schema.

## SPA (Pages)

Pages keeps prior deployments independently of the Worker. Roll back from the Cloudflare Pages
dashboard, or:

```
pnpm exec wrangler pages deployment list --project-name <project>
```

then redeploy/promote the prior deployment from the dashboard.

## Data corruption from a bad migration

Not automated. Rolling back a migration script is out of scope here — if a migration corrupted
data, this is a database restore, not a deploy rollback:

- Neon point-in-time restore, or
- the engineer on call for the `prod` environment.
