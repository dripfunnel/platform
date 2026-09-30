# Rollback: prod

## API Worker — promoting a deploy

`prod.yml` only uploads a Worker version (`wrangler versions upload`); it does not put it live.
The run summary prints the version ID and the exact promote command. To go live, run it
(from `apps/api`, with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for the prod account):

```
pnpm exec wrangler versions deploy <version-id>@100 --env prod -y
```

Nothing serves the new code until this is run — a failed or skipped promotion just leaves the
previous version live.

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
