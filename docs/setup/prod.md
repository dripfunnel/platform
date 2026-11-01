# Production setup

Production on `dripfunnel.ai`: how to set it up once, how values get onto it, and how a
release goes live. **Production is not fully provisioned yet.** §2 says what is missing, and
each step below that hasn't been done is marked **Not done yet**.

Last updated: 2026-11-01 (#1112: `VITE_PLATFORM_URL`, §4). Before: 2026-11-01 (#1086: the production database on PlanetScale, §1, §3.3, §3.4, §6, §7). Before: 2026-10-29 (#875: own delivery for the pilot store, §3.9, §4, §6). Before: 2026-10-26 (the `templates.yml` prod upload and its environment values, §3.6). Before: 2026-10-21 (#825: the `studio-image` action, promote's `studio_digest`, §3.5 step 5). Before: 2026-10-21 (#428: `shops.edge`, the first deploy without routes, §3.5 steps 5 and 6). Before: 2026-10-21 (#816: `env.prod` binds the resources, routes and studio; store-proxy has a prod env, §2, §3.4, §3.5, §4). Before: 2026-10-20 (#809: the asset host is `sf-assets.my-store.one`, §4). Before: 2026-10-15 (#744: `SHOP_DOMAIN` `my-store.one`, §3.5 step 4, §4). Before: 2026-10-14 (#733: observability, §4). Before: 2026-10-11 (#317: `CF_CACHE_PURGE_TOKEN`, the storefront buckets; #518: `PREVIEW_DOMAIN`). Before: 2026-10-09 (`CF_PAGES_POOL` no longer needed).

The deploy design is decided in [ARCHITECTURE.md §6](../ARCHITECTURE.md). What each value is
for, its least scope and how to make it is in
[THIRD-PARTY-ACCESS.md §2 and §8](../code/THIRD-PARTY-ACCESS.md). Promoting and rolling back are
in [ROLLBACK.md](../code/ROLLBACK.md).

**A push to `main` is a production action.** It runs migrations against the production database
and uploads a new Worker version. `main` isn't protected yet, so a direct push deploys with no
pull request.

---

## 1. What production is

| Part | Production |
|---|---|
| Cloudflare account | the production account (Workers Paid), separate from the dev account |
| Zone | `dripfunnel.ai` |
| API Worker | `dripfunnel-api` (`wrangler.jsonc` › `env.prod`) |
| Hosts | `admin.dripfunnel.ai`, `platform.dripfunnel.ai`, `hooks.dripfunnel.ai`; merchant portals on each partner's own host, e.g. `store.<partnerdomain>` (custom hostnames, SAAS.md §8) |
| Consoles | Pages projects `dripfunnel-admin`, `dripfunnel-platform`, `dripfunnel-store` |
| Database | PlanetScale Postgres **18** (Mumbai, PS-40), database `dripfunnel`, through Hyperdrive; on Neon until 2026-11-01 (#1086) |
| Gate | Cloudflare Access on `admin.dripfunnel.ai` (recommended, §2.1) |
| Deploys | `prod.yml` on every push to `main` (gates, migrations, **upload** of the API and store-proxy versions); `promote.yml` by hand (both to 100%, health check, consoles) |
| Third parties | Live mode: Stripe live keys, SES production access, the Entra registration's production redirect |

---

## 2. What is missing today

| Missing | Effect | Step |
|---|---|---|
| `main` unprotected | A direct push deploys without review; `prod.yml` runs its own gates in the meantime | §3.7 |
| The first super admin | Nobody can sign in to an empty production database (dev.md §5) | §6 |

---

## 3. One-time setup

Done once, by whoever holds the production Cloudflare, PlanetScale, Neon, GitHub, Microsoft, Stripe and AWS
admin rights. Take each value straight from its source into its place. Never through chat,
email or a file in the repo.

### 3.1 Cloudflare account and zone

1. Production Cloudflare account on **Workers Paid**.
2. The `dripfunnel.ai` zone in it; SSL **Full (strict)**.
3. Note the **account id** and the **zone id** (dashboard › the zone › overview).

### 3.2 Deploy token

1. Cloudflare › My Profile › API Tokens › *Create token* › custom token, on the **production
   account only**.
2. Permissions: Workers Scripts Edit, Cloudflare Pages Edit, Workers Routes Edit on
   `dripfunnel.ai`, and Queues, Workflows and Hyperdrive Edit (THIRD-PARTY-ACCESS.md §2.1).
3. Copy it once into the GitHub `prod` environment (§3.6).

### 3.3 PlanetScale (the production database) and Neon (the CI test branch)

Production's database moved from Neon to PlanetScale on 2026-11-01 with `pg_dump` and
`pg_restore`, the same way as dev (dev.md §2.3); how, and the checks it passed, are on #1086.
Neon's copy is kept, frozen, as the rollback (ROLLBACK.md).

1. In PlanetScale, a Postgres **18** database, region Mumbai (`ap-south`), PS-40, single node.
   Create its **default role** (*Connect* › default role); it sets up the roles below and
   nothing else, never the Worker.
2. As that default role, the **migration role** `neondb_owner` (`CREATEROLE`, `BYPASSRLS`) and
   the database `dripfunnel` it owns, as in dev.md §2.3 step 2. Used only by `prod.yml`.
3. As `neondb_owner` in `dripfunnel`, before any restore: the nine `app_*` roles, `CREATE` on
   `public` for `app_definer`, and the **app role** `app_login`, what the Worker connects as,
   **without** `CREATEROLE` or `BYPASSRLS`, granted `app_request, app_system, app_platform,
   app_partner, app_supplier, app_shop, app_rider` ([DATA-MODEL.md §5.3](../api/DATA-MODEL.md)).
   On Neon this login was `hyperdrive_user`, with both rights; it was not carried over (#1086).
4. A login connects as `<role>.<branch id>` on the **direct** port 5432, database `dripfunnel`:
   - `neondb_owner.<branch id>`, `?sslmode=verify-full` → `PROD_DATABASE_URL`;
   - `app_login.<branch id>` → Hyperdrive (§3.4).
5. CI tests stay on a disposable **Neon** branch, never the production database: its string →
   `TEST_DATABASE_URL` (prod's own, not dev's).
6. Note the two hostnames → `ALLOWED_MIGRATION_HOST` and `ALLOWED_TEST_HOST`.

**Moving the database again**, in this order: copy and check; a new Hyperdrive config; the
`prod` environment's `PROD_DATABASE_URL` and `ALLOWED_MIGRATION_HOST`; merge the `env.prod`
change; promote. Nothing else merges to `main` in between, because a merge migrates whatever
`PROD_DATABASE_URL` names while the live version still uses the old database.

### 3.4 Hyperdrive, R2, the queue and Containers — **Not done yet**
`env.prod` in `apps/api/wrangler.jsonc` binds all of these (#816), so create them **before** the change merges to `main`: a binding to a missing bucket, queue or Hyperdrive fails the deploy, and a push to `main` runs migrations.
1. Create Hyperdrive on the production account, and put its id in `env.prod`'s `hyperdrive` binding:
   ```bash
   wrangler hyperdrive create dripfunnel-prod-ps --connection-string="<app_login's string, §3.3>" --origin-connection-limit=<n>
   ```
   The limit stays under the database's direct connections (*Direct: x/N* on PlanetScale's dashboard); Hyperdrive's own default is 60. **Done** (2026-11-01, #1086): `dripfunnel-prod-ps`; the Neon config `3f5dde45…` is kept as the rollback.
2. Set `HYPERDRIVE_REQUIRED=1` on the Worker (§4) in the same release, so a lost binding turns
   `/api/health` red.
3. Create the buckets: `wrangler r2 bucket create` for `dripfunnel-assets-prod`, `storefront-sites-prod`, `storefront-assets-prod` and `storefront-drafts-prod` (the assets host and CORS: §4, `CF_CACHE_PURGE_TOKEN`).
4. `wrangler queues create dripfunnel-outbox-wake-prod`. Without it the every-minute cron delivers email and texts.
5. Turn on Containers and Durable Objects on the production account. Run `release.yml` once so the registry holds a stable `storefront-build:<x.y.z>` tag: `prod.yml`'s *Studio image* step (the `studio-image` action) takes the newest and writes its digest into the runner's copy of `wrangler.jsonc`, and prints it in the run summary; with none it fails and says so. `promote.yml` takes that digest as its required `studio_digest` input; the verify step refuses a digest that is not the one in the API version's upload message. Nothing is committed.
6. The Workflows (`dripfunnel-{create-storefront,publish-storefront,render-page,core-upgrade}-prod`) are created by the first upload; the deploy token needs Workflows: Edit (§3.2).
### 3.5 Routes and console hostnames — **Not done yet**
1. `env.prod` routes `admin.dripfunnel.ai/api/*` and `platform.dripfunnel.ai/api/*` on the zone, and `hooks.dripfunnel.ai` as a custom domain. There is no `store.` route: merchant portal hosts come with Cloudflare for SaaS (SAAS.md §8).
2. After the first `promote.yml` creates the Pages projects, attach `admin.dripfunnel.ai` to
   `dripfunnel-admin` and `platform.dripfunnel.ai` to `dripfunnel-platform` (Pages › the
   project › Custom domains).
3. Put Cloudflare Access in front of `admin.dripfunnel.ai`, connected to the staff identity
   provider (THIRD-PARTY-ACCESS.md §2.1).
4. Store addresses, by hand (#744): add `my-store.one` as a zone on the main Cloudflare account, add the proxied wildcard record `*.my-store.one`, and confirm Universal SSL covers it. `store-proxy`'s `env.prod` (#816) holds the routes `*/*` on `dripfunnel.ai` and `*.my-store.one/*` on `my-store.one`; `prod.yml` uploads its version after the API's and `promote.yml` promotes both together (it is never deployed from a push). In the zone's Logpush, leave out `ClientRequestPath` and `ClientRequestQuery` (LOGGING §9).
5. Edge records, by hand (#428): in the `dripfunnel.ai` zone, `portal.edge` and `shops.edge` are two proxied records pointing at the same origin, the zone's one Cloudflare for SaaS fallback origin (SAAS.md §8; no `preview.edge`, previews are on `SHOP_DOMAIN`). Check that both resolve (`dig +short portal.edge.dripfunnel.ai`, `shops.edge.dripfunnel.ai`), and that the fallback origin is set to `portal.edge.dripfunnel.ai`.
6. First deploy of store-proxy, one-off (#428, **not yet run against a real account**): `wrangler versions upload` fails for a Worker that does not exist yet, and neither it nor `versions deploy` applies `routes` (Cloudflare: Gradual deployments; `wrangler triggers deploy` applies them). So create the Worker with no routes, which serves nothing (`workers_dev` is off): once the API Worker exists (the proxy's service bindings need it), in `store-proxy/` copy `wrangler.jsonc` to `wrangler.bootstrap.jsonc`, set `env.prod.routes` to `[]`, run `pnpm exec wrangler deploy --config wrangler.bootstrap.jsonc --env prod`, then delete the copy. Set `PREVIEW_SESSION_KEY` on `dripfunnel-store-proxy-prod` (§4). Nothing reaches the zone until the routes are applied, which is done right after the first `promote.yml` has moved the API and store-proxy to 100%: `pnpm exec wrangler triggers deploy --env prod` in `store-proxy/`, then check in the dashboard (Workers & Pages › the Worker › Settings › Domains & Routes) that `*/*` on `dripfunnel.ai` and `*.my-store.one/*` are there, open the consoles and send a test webhook to `hooks.dripfunnel.ai`. To back out, delete the two routes there. Later releases need only `prod.yml` and `promote.yml`; run `triggers deploy` again when `routes` changes.
### 3.6 GitHub environment `prod`

`release.yml`'s `templates-prod` job, after `sandbox-image` has recorded the version, runs `templates.yml`'s `upload-prod` job (a `workflow_run` trigger would run off the default branch, which this environment refuses, and a push to `main` would rewrite a released core's templates before its release): it builds each theme's preview and writes the templates to `storefront-sites-prod` for the version just recorded, from the release's commit (`seed-templates.ts --remote --released --core <version>`, which refuses a version without a `core_release` row; it never runs without that version, so a manual dispatch skips it: re-run the release run's `templates-prod` job instead), so `templates/current.json` never names a core whose image isn't recorded. It needs the secrets and variables below.

Repository › Settings › Environments › *New environment* › `prod`:

1. **Deployment branches:** `main` only.
2. **Required reviewers:** recommended, so `promote.yml` waits for a second person.
3. **Secrets:**

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from §3.2 |
   | `PROD_DATABASE_URL` | the migration role's direct string |
   | `TEST_DATABASE_URL` | prod's disposable test branch |
   | `R2_STOREFRONT_ACCESS_KEY_ID`, `R2_STOREFRONT_SECRET_ACCESS_KEY` | the R2 upload key pair of the Worker's values (§4); `templates.yml` uploads the templates with it |

4. **Variables:**

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | the production account id |
   | `ALLOWED_MIGRATION_HOST` | the hostname in `PROD_DATABASE_URL` |
   | `STOREFRONT_SITES_BUCKET` | `storefront-sites-prod` |
   | `ALLOWED_TEST_HOST` | the hostname in prod's `TEST_DATABASE_URL`; must differ from the one above |

### 3.7 Protect `main`

When the `dripfunnel` org moves to GitHub Team: apply the `protect-main` ruleset (pull requests
only, the CI `gates` check required, no force-push or deletion), then remove the `gates` job
from `prod.yml` (ARCHITECTURE.md §6).

### 3.8 Moving prod from `dripfunnel.com` to `dripfunnel.ai` (#907)

One-off, done by a person; the repo already names the new zone. Emails stay `@dripfunnel.com`.
1. Use the `dripfunnel.ai` zone in the prod account; point the deploy token's zone scope (§3.2) and the
   `admin`, `platform` and `hooks` routes and custom domains at it (§3.5).
2. Set `EDGE_ZONE`, `ADMIN_HOST`, `PLATFORM_HOST`, `HOOKS_HOST` and `CF_SAAS_ZONE_ID` (§4), and the `CF_CACHE_PURGE_TOKEN` zone.
3. Create `portal.edge` and `shops.edge` on `dripfunnel.ai`, and re-point every existing custom-hostname CNAME
   from `*.edge.dripfunnel.com`.
4. Update the callbacks: Stripe webhook and Connect redirect, SES/SNS subscription, the Entra redirect URIs.

### 3.9 Own delivery for the pilot store (#875, DL 19) — **Not done yet**

Production runs the same code as dev; own delivery needs configuration, the pilot store's production build and a checked walkthrough
(DELIVERY.md; mobile-app/delivery/BUILD-CHECKLIST.md). It is on for **the pilot store only**; the shop app's release (SH 18) and other stores are not part of it.
Gaurav applies the values and runs `promote.yml`; nobody pushes `main` for this. Every value below is named, never written down here or on the card.

| # | Step | Done by | How to check |
|---|---|---|---|
| 1 | Worker secret `EXPO_PUSH_TOKEN` (§4), from an expo.dev robot user with Enhanced Security for Push Notifications on (THIRD-PARTY-ACCESS §2.13) | Gaurav | `wrangler secret list --env prod` names it; after the Worker's next start, `/api/health` is still green (a malformed value fails boot). Push is proved in step 8 |
| 2 | The pilot store's own Firebase project: `google-services.json` as an EAS file secret and the Maps key (BUILD-CHECKLIST §2) | Gaurav / the pilot's owner | `eas env:list` for the pilot's EAS project names both |
| 3 | store-proxy passes `/delivery-api/*` and `/app/delivery.apk` on the prod shop zone. It already does (`store-proxy/src/live.ts` `isApiPath`), so there is nothing to change: confirm the §3.5 routes `*.my-store.one/*` exist | Gaurav | `curl -s -o /dev/null -w "%{http_code}" https://<pilot slug>.my-store.one/delivery-api/` answers from the API (a JSON error, not the storefront's HTML) and the same path on `https://dripfunnel.ai/delivery-api/` answers 404 (the hostname guard, DELIVERY §10) |
| 4 | The minute Cron runs in prod: the offer-round sweep (DELIVERY §3) is the `* * * * *` entry of the Worker's `triggers` | Gaurav | dashboard › Workers & Pages › `dripfunnel-api` › Settings › Triggers lists `* * * * *`, and Observability › Cron events shows a run in the last minute. If it is missing, ask before adding an `env.prod` triggers block |
| 5 | The pilot store has `own_delivery` on and a riders limit (DELIVERY §9). **Not possible as decided yet:** `store_limit_override` holds amounts only and the admin console has no override, so there is no way to switch `own_delivery` on for one store. Until the follow-up card is built, the pilot's partner gives that one store a plan with `own_delivery` on and the riders limit set | DripFunnel staff | Settings › Riders in the pilot's portal lists the Invite button; `inviteRider` is not refused `PLAN_LIMIT`; another store still is |
| 6 | The pilot's production APK (prod profile and store file: not in the repo yet, BUILD-CHECKLIST §7) uploaded in the admin console › Stores › the store › Delivery app, minimum build set | Staff, with the pilot's owner | the store's `/app/delivery.apk` link downloads it; two riders install it |
| 7 | Two riders invited and signed in (Settings › Riders, then the app) | The pilot's owner | both show Active, and each reaches Home |
| 8 | The walkthrough below | Staff and the two riders | the table, every row passing, recorded on the card |

**Walkthrough on production** (real riders, real data: say it is a test; refund or cancel every test order). Record each row's result, who and when on #875.

| # | Check | Pass when |
|---|---|---|
| W1 | A cash-on-delivery order, placed on the pilot's website, then a prepaid one | both reach Own delivery at checkout and are placed |
| W2 | Both riders go Online | the location disclosure shows once, then Online |
| W3 | The delivery is offered | both riders get the push and see the offer |
| W4 | One accepts | the other's offer disappears (taken) |
| W5 | Pickup, then the handover code, then delivered | each step moves the state; the code is asked for; cash is collected on the COD one |
| W6 | The customer's tracking page on the website | it follows the state (no map, DELIVERY §3) |
| W7 | A test crash from the app (BUILD-CHECKLIST §5) | it appears in Crashlytics for the pilot's project |
| W8 | The measurements are visible (the alerts below) | `dispatch_accept_seconds` and `dispatch_offers_per_delivery` have values for these deliveries |
| W9 | Both test orders refunded or cancelled | the order pages say so |

**Alerts**, set once W8 shows the numbers (what DELIVERY §3 "Measured" emits):
- `dispatch_unassigned` rising against deliveries created.
- `dispatch_accept_seconds` over the store's own offer minutes.
- `push_send_failed` with code `DeviceNotRegistered` rising.
- `dispatch_late_step` for one store.
- Any of the log lines `dispatch_offer_failed`, `push_failed`, `push_receipts_failed`, `dispatch_sweep_failed`.

Thresholds come from what W8 and the first week show; write the chosen numbers on #875 and here.

**Rolling back a bad Delivery API deploy:** ROLLBACK.md "A bad Delivery API deploy".

---

## 4. The Worker's values

Cloudflare dashboard (production account) › Workers & Pages › **`dripfunnel-api`** › Settings ›
**Variables and Secrets** › *Add*, or `wrangler secret put <NAME> --env prod` from `apps/api`.
A deploy keeps them (`keep_vars`). Saving one deploys it at once, so production changes the
moment you save.

**Every secret is production's own.** Never one from dev or a laptop.

| Name | Type | Production value | How to get it |
|---|---|---|---|
| `ADMIN_HOST` | Text | `admin.dripfunnel.ai` | fixed |
| `EDGE_ZONE` | Text | `dripfunnel.ai` | The zone holding the Cloudflare for SaaS fallback origins (`portal.edge.<zone>` and `shops.edge.<zone>`, SAAS.md §8, §3.5 step 5); the CNAME targets partners and merchants are shown |
| `CF_SAAS_ZONE_ID` | Text | the id of the `dripfunnel.ai` zone | Cloudflare for SaaS custom hostnames (SAAS.md §8). Without it and the token no hostname is registered, and a portal address goes live on DNS alone |
| `CF_CUSTOM_HOSTNAMES_TOKEN` | Secret | an API token | THIRD-PARTY-ACCESS.md §2.1: *SSL and Certificates: Edit* on that zone only |
| `PLATFORM_HOST` | Text | `platform.dripfunnel.ai` | fixed |
| `HOOKS_HOST` | Text | `hooks.dripfunnel.ai` | fixed |
| `HYPERDRIVE_REQUIRED` | Text | `1` | in the same release as the binding (§3.4) |
| `CODE_CHECK` | Text | unset (codes are checked) | `0` accepts any email or text code, so anyone who knows an email or phone can sign in to that account, 2-factor included; set it on prod only knowingly |
| `CREDENTIALS_KEK` | Secret | a new key | `openssl rand -base64 32`. Store it in the password manager **before** saving it. Losing it makes every encrypted 2-factor secret and partner or merchant credential unreadable for good; it carries a version for rotation (THIRD-PARTY-ACCESS.md §5) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Secret | the staff registration | Entra admin center (THIRD-PARTY-ACCESS.md §2.5). Redirect URI `https://admin.dripfunnel.ai/api/auth/callback`. The client secret expires (24 months at most): note the date |
| `STRIPE_SECRET_KEY` | Secret | **live** restricted key `rk_live_…` | Stripe (live mode) › Developers › API keys › *Create restricted key*, with only the permissions in THIRD-PARTY-ACCESS.md §8 |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_…` | Stripe (live mode) › Webhooks › *Add endpoint* `https://hooks.dripfunnel.ai/stripe`, events as in §8, *Listen to events on Connected accounts* Since #309 the same endpoint also receives connected merchant accounts' events (THIRD-PARTY-ACCESS §3.1) |
| `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | Secret | the sending IAM user | THIRD-PARTY-ACCESS.md §2.4. Ask for SES **production access** early; approval takes days |
| `SES_SENDER_DOMAIN` | Text | `dripfunnel-mail.com` | verified in SES with DKIM, SPF and DMARC; partners' fallbacks are its subdomains |
| `EMAIL_SUPPRESSION_KEY` | Secret | a new key | `openssl rand -base64 32`; keys the suppression list's hashes. Email doesn't send without it |
| `SES_EVENTS_TOPIC_ARN` | Secret | the production bounce topic's ARN | SNS topic with `SignatureVersion` 2, subscribed to `https://hooks.dripfunnel.ai/ses` |
| ~~`CF_PAGES_POOL`~~ | — | — | Not needed since 2026-10-09: no Pages project per store; the R2 storefront upload credential replaces it (THIRD-PARTY-ACCESS §2.1, names on #317) |
| `STRIPE_CONNECT_CLIENT_ID` | Text | the **live** `ca_…` | Stripe (live mode) › Connect › Settings, with the redirect `https://hooks.dripfunnel.ai/stripe/connect/callback` (THIRD-PARTY-ACCESS §3.1). Read since #309 |
| `STRIPE_PUBLISHABLE_KEY` | Text | the **live** `pk_live_…` | Stripe (live mode) › Developers › API keys |
| `STRIPE_TEST_SECRET_KEY` | Secret | a **test-mode** restricted key `rk_test_…`, permissions as `STRIPE_SECRET_KEY`'s | For checkout on preview storefronts in test mode (THIRD-PARTY-ACCESS §8.1); with the next row or neither |
| `STRIPE_TEST_PUBLISHABLE_KEY` | Text | the test-mode `pk_test_…` | Stripe (test mode) › Developers › API keys |
| `CF_CACHE_PURGE_TOKEN` | Secret | a *Zone › Cache Purge* token on the `dripfunnel.ai` zone | Purges the store proxy's cached host lookups (storefront LIVE-SHOP.md §5 step 1); read since #317 with `CF_SAAS_ZONE_ID`. The buckets `storefront-sites-prod`, `storefront-assets-prod` (custom domain `sf-assets.my-store.one`, CORS `GET` from any origin, its route excluded from the Worker) and `storefront-drafts-prod` are created and bound as on dev (dev.md §2.8 item 1), with `-prod` in place of `-dev` |
| `SHOP_DOMAIN` | Text | `my-store.one` | Every store's free addresses, `{slug}.my-store.one` and `{slug}-preview.my-store.one` (PREVIEW.md §8). Validated at boot; replaces `PREVIEW_DOMAIN` (#744): without it no store or preview host answers |
| `EXPO_PUSH_TOKEN` | Secret | the Expo access token | expo.dev robot user, Enhanced Security on (THIRD-PARTY-ACCESS §2.13, §8.1). Pushes to the shop and delivery apps; without it they wait in the outbox. §3.9 step 1 |
| `PREVIEW_LINK_KEY` | Secret | a new key | `openssl rand -base64 32`, production's own. Read since #317 ("Open preview" links). The store proxy (`dripfunnel-store-proxy-prod`) gets its own `PREVIEW_SESSION_KEY`, its value only (the `SITES` and `EDGE` bindings, routes and `SHOP_DOMAIN` are in its `env.prod`, §3.5) |
| `PEXELS_API_KEY` | Secret | a free key from pexels.com/api | Optional. Adds Pexels to the studio's free photo search (AI-STUDIO §8); unset leaves it out. Openverse and Wikimedia Commons need no key |
| `AI_PHOTOS` | Text | `1` | Optional, default off. Lets the studio's AI search and add photos itself, from the sources in `AI_PHOTO_SOURCES` (AI-STUDIO §8). Only `1` is accepted; read at boot, so it needs a new version |
| `AI_PHOTO_SOURCES` | Text | e.g. `openverse,commons` | Optional, with `AI_PHOTOS`: the sources the AI may use, from `pexels,pixabay,openverse,commons`; unset is `openverse,commons`; an unknown name stops the Worker at boot. Read each source's terms for automated use before naming it |

The consoles' build flags in production: `VITE_STATE_HARNESS` stays **unset** (no `?state=`
harness in production). `VITE_ADMIN_URL` defaults to `https://admin.dripfunnel.ai`, and the store portal's `VITE_PLATFORM_URL` (where a spent support link sends the agent) to `https://platform.dripfunnel.ai`.

The Worker's observability is set in `apps/api/wrangler.jsonc` (`env.prod`): Workers Logs on, **invocation logs and traces off on purpose** (LOGGING §9: they record URLs, and some carry a token). Don't switch them on in the dashboard.

---

## 5. Releasing

1. Merge a pull request into `main`.
2. **prod.yml** runs: gates against the test branch → migrations against production →
   pins the studio image, uploads a new API version, then a store-proxy version. **Nothing is live yet.** On the very first release, apply the store-proxy routes after promote (§3.5 step 6).
3. Open the run's summary. It gives both **version ids**, the **commit sha** and the **studio image digest**.
4. Run **promote** (Actions › promote › *Run workflow*) with `version_id`, `proxy_version_id`,
   `commit_sha` and `studio_digest`, soon after, and only for the most recent upload. It:
   1. checks that both versions were built from that commit;
   2. moves the API Worker, then store-proxy, to 100%;
   3. runs `wrangler deploy --containers-rollout immediate` once, because `versions deploy` never creates or updates the studio's container application (#881). It makes a new version of the same code, and fails unless that version's `StudioSession` image is the promoted `studio_digest` (a Durable Object container application keeps its image on the version, so `wrangler containers list` shows none);
   4. checks `https://platform.dripfunnel.ai/api/health` reports that new version;
   5. only then builds and deploys the three consoles from the same commit.
5. If the health check fails, or something is wrong after release, follow
   [ROLLBACK.md](../code/ROLLBACK.md).

Migrations run at step 2, before the new version is live, so every migration must work with the
version still running (AGENTS.md "Data").

---

## 6. Checklist

- [ ] Account, zone, SSL Full (strict) (§3.1)
- [ ] Deploy token (§3.2)
- [x] PlanetScale production database, migration and app roles; Neon test branch (§3.3)
- [ ] Hyperdrive, the four R2 buckets and the outbox queue `dripfunnel-outbox-wake-prod` created before `env.prod` merges (§3.4)
- [ ] Containers and Durable Objects on; a stable `storefront-build` tag in the registry (§3.4)
- [ ] Routes, console hostnames, Access on admin (§3.5)
- [ ] GitHub environment `prod`, with required reviewers (§3.6)
- [ ] `main` protected (§3.7)
- [ ] Every Worker value in §4, with the KEK in the password manager; `CODE_CHECK` unset unless you accept any code on prod
- [ ] SES production access granted
- [ ] The first super admin can sign in (§7)
- [ ] Own delivery for the pilot store, every row of §3.9 checked and its walkthrough recorded on #875
- [ ] A first release promoted, with `/api/health` reporting `db: "ok"` (§5)

---

## 7. Open questions

1. ~~Production database: its own Neon project, or a branch.~~ Answered on #1086: PlanetScale, §3.3.
2. How the first super admin is created on an empty production database. *(decide)*
