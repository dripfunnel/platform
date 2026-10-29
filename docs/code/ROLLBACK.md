# Rollback: prod

## API Worker — promoting a deploy

`prod.yml` only uploads a Worker version (`wrangler versions upload`); it does not put it live
and does not deploy the SPAs. The run summary prints the version ID. To go live, run the
**promote** workflow (`workflow_dispatch` on `promote.yml`) with that `version_id`, the
store-proxy's `proxy_version_id`, the commit's `commit_sha` and the run summary's `studio_digest`. It promotes both Workers to 100%, then runs `wrangler deploy --containers-rollout immediate` once from that commit (only `deploy` applies the studio's container image, #881), which makes a **new version of the same code**: the one that ends up live, health-checked and named in the log. It checks that version's message names the commit. Then it health-checks the live prod host and —
only if that succeeds — builds and deploys all three SPAs from that same commit. If you'd rather
promote by hand instead (from `apps/api`, with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for
the prod account):

```
pnpm exec wrangler versions deploy <version-id>@100 --env prod -y
pnpm exec wrangler deploy --env prod --keep-vars --containers-rollout immediate
```

The second command is needed only when the studio's image changed (a new `studio_digest`) or the container application has none.

Every `wrangler` command in `apps/api` (and `store-proxy/`) refuses to read `wrangler.jsonc` while its studio image is still the
`PROD_STUDIO_IMAGE` placeholder, rollbacks included. Before any of them, replace it with
`registry.cloudflare.com/<account-id>/storefront-build@<digest>` in your copy (not committed); prod.yml's run summary
prints the digest. `promote.yml` does this itself, and refuses a `studio_digest` that is not in the API version's upload message; a version uploaded before #825 has only the commit there, so it cannot be promoted that way.

Nothing serves the new code until this is run — a failed or skipped promotion just leaves the
previous version live. If you promote by hand, deploy the SPAs by hand too (see below) — skipping
`promote.yml` means nothing enforces that they come from the same commit as the Worker.

Run `promote.yml` shortly after the `prod.yml` run it follows: it checks out `commit_sha` to
build the SPAs *and* to run the deploy actions themselves, so promoting a stale commit runs old
deploy tooling against a new dispatch. Don't queue a promotion for a commit that isn't the most
recent one uploaded.

## API Worker — rolling back

The previous version is still stored by Cloudflare — no rebuild needed.

```
pnpm exec wrangler versions list --env prod
pnpm exec wrangler versions deploy <previous-version-id>@100 --env prod -y
```

`versions deploy` does not touch the studio's container application, so the image stays on the newer digest. If the image is the bad part, put the previous digest in your copy of `wrangler.jsonc` (above) and run `pnpm exec wrangler deploy --env prod --keep-vars --containers-rollout immediate` from the previous commit.

This is safe because migrations are required to be backward-compatible with the previously
running version (ARCHITECTURE.md §6) — the old Worker code keeps working against the current
schema.

The store-proxy rolls back the same way, from `store-proxy/` (`--env prod`), when its own version is the bad one.

## A bad Delivery API deploy

The Delivery API is part of the API Worker, so it rolls back with it (above). If riders are mid-delivery:
1. Roll the Worker back first. A rider's deliveries, offers and codes are in the database and survive the old version (migrations are backward-compatible).
2. A bad **app** build is the other half: in the admin console › Stores › the store › Delivery app, set the minimum build back below the bad one, or upload the previous APK, so riders are not stopped at Update required.
3. Check with the store's owner that no rider holds a parcel with no way to finish. A parcel in transit is never reassigned (DELIVERY §3): the Owner can recall it (`cancelDelivery`, reason `recalled`), which tells the rider by push to bring it back, or, for an unconfirmed code, move it on.
4. Then check the minute Cron still runs (Triggers in the dashboard) and a test delivery is offered.

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
