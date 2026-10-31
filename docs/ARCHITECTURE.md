# ARCHITECTURE.md: platform

How the whole DripFunnel platform is laid out and deployed. **This document wins where an
older one disagrees**: `api/PLATFORM-PROMPT.md`, `code/ARCHITECTURE.md`,
`storefront/ARCHITECTURE.md` and `ui/admin/CONSOLE-DESIGN.md` were written before some of the
decisions in §1 and are being brought in line.

**Status: skeleton.** The layout below exists and passes every gate; no features yet.

Last updated: 2026-10-31 (#1071: the dev database on PlanetScale, §1, §2, §6). Before: 2026-10-23 (#839: the Delivery API built, answering only on a store's free address through `StorefrontEdge`, §1, §2). Before: 2026-10-22 (with Gaurav: the shop and delivery apps, one build per store, and the Delivery API on `{slug}.<SHOP_DOMAIN>`, §1–§3, proposed: api/DELIVERY.md, mobile-app/README.md). Before: 2026-10-18 (#790: the one secret a store repo reads is the org's `GHCR_PULL_TOKEN`, for the build image's pull). Before: 2026-10-15 (#744, #745: every store's free addresses on `SHOP_DOMAIN`, `{slug}.` live and
`{slug}-preview.` preview, §1 and §8; no per-store Cloudflare hostnames). Before: 2026-10-14 (#733: Workers logs only, no traces, §7). Before: 2026-10-13 (#637: the portal host lookup kept 60 s in the cache, §2). Before: 2026-10-12 (#496: the merchant mobile app's project, §1–§3). Before: 2026-10-11 (#317: store-proxy's `StorefrontEdge` entrypoint; before it #518: the Shop API answers on preview
hosts by preview key). Before:
2026-10-09 (with Gaurav: storefront builds in each store's public repo on GitHub
Actions, files in R2 served by the edge Worker, previews on `webpreview.store`, since moved).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Six kinds of user and their hostnames**: Admin on `admin.dripfunnel.ai`; Partners on `platform.dripfunnel.ai`; merchants and vendors on each partner's own portal host; customers on merchants' domains and their stores' shop apps; riders in their stores' delivery apps *(proposed)*. Full detail in [USERS-AND-DOMAINS.md](USERS-AND-DOMAINS.md) | Per-partner consoles; one shared merchant portal host; Admin and Partners in one console | Partners are our customers and use one console we own; merchants see only their partner's brand. Staff get their own console and host, so an Admin screen or endpoint can never be reached from a partner session, and Cloudflare Access can guard the whole admin host. |
| **One repo, `dripfunnel/platform`**, for every app, the storefront package and template, and all docs | Four repos (packages, store, admin, template) | One schema and one migration history for one database; an AI agent (or a person) can follow a change from table to API to screen and make it in one pull request; one copy of the rules. Generated **store repos** stay separate by design. |
| **Four apps**: `api` (one Worker) and three SPAs in `apps/ui/`: `store`, `platform` and `admin`; the mobile apps are separate rows below (merchant, and the proposed shop and delivery apps) | Five API Workers; a package per concern | Fewest moving parts: one API deploy, one config, one set of bindings, no wiring copied between Workers. The modules inside `api` stay separate, so splitting a Worker out later is cheap. |
| **The merchant mobile app is a React Native (Expo) project in this repo**, `apps/ui/mobile-app/merchant`, inside the pnpm workspace and the turbo gates (`typecheck`, `lint`, `test`; no `build`). Its builds and store submissions are manual, per partner (decided 2026-10-08 on #490; set up on #496) | A separate mobile repo; building and submitting it from the `dev` and `prod` pipelines | One repo is the rule above: a change can go from the GraphQL schema to a mobile screen in one pull request. Every submission goes through Apple's and Google's review, so a person decides when each partner's app ships ([mobile-app/merchant/](mobile-app/merchant/REACT-NATIVE.md)). |
| **Two more mobile apps, built per store and published from the merchant's own developer accounts**: the shop app (`apps/ui/mobile-app/shop`, the store's customers, on the Shop API) and the delivery app (`apps/ui/mobile-app/delivery`, the store's riders, on the Delivery API), in the same workspace and gates as the merchant app (decided 2026-10-22 with Gaurav; builds per store *(proposed)*, [mobile-app/README.md](mobile-app/README.md)) | A rider mode in the merchant app; per-partner shop and delivery apps | The merchant gives both, in the store's brand. Apple's 4.2.6 and the stores' spam rules apply one level down from the merchant app's. |
| **The Delivery API** at `/delivery-api/` on `{slug}.<SHOP_DOMAIN>`, served by the same Worker, built on #839 ([api/DELIVERY.md](api/DELIVERY.md) §4) | Rider operations inside the Store or Shop API | Its own caller kind, schema and hostname guard: riders, shoppers and merchants can't reach each other's operations. |
| **One API Worker** serves the Store, Platform, Admin, Shop and Delivery APIs, webhooks, queues, Cron and Workflows, choosing by hostname and path (§2) | A Worker per API | Simpler. Its costs are covered: a bad deploy is limited by manual promotion and instant rollback, and a hostname guard with a test keeps each API off hosts it doesn't belong on. |
| **Only code the AI could reach is a published package**: `@dripfunnel/storefront-core`, installed by store repos | Publishing shared internal code | Store repos are the only code outside this repo, and the AI writes their themes (storefront/ARCHITECTURE.md §1). The core they run must be versioned and outside the files the AI may change. Our own apps ship from one commit and need no versions. |
| **AI changes run in Cloudflare Containers** (`apps/sandbox`'s image), each store's held by a Durable Object in the API Worker (decided 2026-10-08 on #470). **Storefront builds run in each store's public repo on GitHub Actions**, inside the same image published on `ghcr.io` (a private package: the build pulls it with the org's read-only `GHCR_PULL_TOKEN`, decided on #790), with no other secret in any repo (decided 2026-10-09 with Gaurav) | GitHub Actions for AI changes (decided 2026-10-05 on #284); builds in Containers (2026-10-08, replaced); a third-party sandbox | Workers can't run a build. Containers give each studio its own machine in seconds, next to R2 and the Worker, with no network and no credential (storefront/AI-STUDIO.md). Builds cost nothing on public repos and upload through 15-minute credentials the API mints after a GitHub OIDC check (storefront/LIVE-SHOP.md §1). |
| **`apps/ui/shared/` holds only code that more than one app uses**, today browser code the SPAs share | Shared packages in advance | Nothing is shared before a second app needs it. Server code lives only in `apps/api`, so it can't leak into a browser bundle. |
| **UIs are independent static SPAs on Cloudflare Pages** | Next.js servers that also host the API | A UI deploy can't break the API and the reverse; UIs are pure static assets served from the edge; any client (the SPAs, integrations) uses the same APIs. |
| **The SPAs are built with Vite, React and TanStack Router** | Next.js static export | A pure client-side app: fast builds, no server features to avoid, typed routes and search params. Next.js stays only in the storefront template, which needs static generation. |
| **The API runs on Cloudflare Workers** | Containers on AWS | The same edge platform as the UIs and storefronts; no servers to run; scales per request. The cost is Workers' runtime constraints (§4). |
| **The API is served at `/api` on each UI's own hostname** (a Worker route), including partners' custom domains | A separate `api.` host; one central API domain | Same origin: `httpOnly` session cookies stay first-party, no CORS, one hostname per partner. |
| **Postgres on Neon, reached through Cloudflare Hyperdrive** | Cloudflare D1; AWS RDS | Keeps Postgres features the design relies on (row-level security, `SKIP LOCKED`, JSONB, full-text search). Neon adds a database branch per feature environment. The one part of the platform not on Cloudflare. The dev environment's database is PlanetScale Postgres in Mumbai instead (#1071, 2026-10-31): the same Postgres 18 and roles, cheaper always on and nearer the team; feature environments and CI tests stay on Neon for its branches. |
| **Background work on Cloudflare Queues, Workflows and Cron Triggers** | A polling job runner process | Workers have no always-on process. Queues carry outbox events and jobs; Workflows run durable multi-step jobs with retries and compensation (provisioning, publishing); Cron runs schedules (automatic publish, cleanups). The `job` table in Postgres stays as the record the platform console reads. |
| **Files on Cloudflare R2** | S3 | Product photos, brand assets, imports, exports and invoices, with zero egress cost and a Worker binding. |
| **Email through Amazon SES** (HTTP API) | SMTP; Postmark; Resend | Workers can't use SMTP libraries; SES supports many verified sender domains (one per partner) at low cost. |
| **The storefront template lives in this repo** (`templates/storefront`), and provisioning **copies it into each new store repo through the GitHub API** | A separate template repo | The template is developed and tested with the package it depends on; no second repo to keep in sync. |
| **GraphQL is code-first with Pothos, served by GraphQL Yoga**; `.graphql` files are generated into `apps/api/schema/` | Schema-first `.graphql` files | A field's scope declaration sits where the field is defined, so an unscoped field can't exist; the generated files still give clients and CI a readable contract. |
| **Unit tests beside the code** (`service.test.ts` next to `service.ts`); integration tests in `apps/api/tests/` | Everything under `tests/` | Tests move and are deleted with the code they cover. |
| **Everything in the `dripfunnel` GitHub org**, `storefront-core` on GitHub Packages | `SoftoboticsTechnologies`; npmjs.com | See `code/ARCHITECTURE.md` §5. |

---

## 2. Deployables

| Deployable | Kind | Serves | Hostnames |
|---|---|---|---|
| `apps/api` | **Worker** (one) | Store API, Platform API, Admin API, Shop API, the Delivery API (#839), inbound webhooks; queue consumers, Workflows, Cron | `/api/*` on every portal host, on `platform.dripfunnel.ai` and on `admin.dripfunnel.ai`; `/shop-api/*` on every storefront host and every preview host, `{slug}-preview.<SHOP_DOMAIN>`; `/delivery-api/*` on `{slug}.<SHOP_DOMAIN>` *(proposed)*; `hooks.dripfunnel.ai` |
| `store-proxy` (the edge Worker) | **Worker** | Sits on the zone's `*/*` route in front of the hosts that reach us through Cloudflare for SaaS, and on `*.<SHOP_DOMAIN>/*` in the shop zone (`my-store.one` in prod, `my-shop.dev` on dev, `my-store.localhost` locally; USERS-AND-DOMAINS §2). Partner portal hosts: `/api/*` to the API Worker's `PortalProxy` entrypoint through a service binding, the rest to the store Pages project. Storefront hosts and `*.<SHOP_DOMAIN>`: each store's built files from R2, `/shop-api/*` to the API Worker's `StorefrontEdge` entrypoint, which also answers its host lookups (storefront/LIVE-SHOP.md §5, PREVIEW.md §5; decided 2026-10-09, entrypoint on #317). Our own hosts pass through (SAAS.md §8). Portal part: dev, and prod once the routes are applied after the first promote (setup/prod.md §3.5 step 6); the storefront part is built (#317) and is bound on dev once #287's bucket and the dev shop zone exist | every partner portal host; every merchant domain; `*.<SHOP_DOMAIN>` |
| `apps/ui/store` | **Pages** (static SPA) | Merchant and vendor portal, in the partner's look | Each partner's portal host (e.g. `store.<partnerdomain>`), chosen by the partner |
| `apps/ui/platform` | **Pages** (static SPA) | The platform console for **Partner** users | `platform.dripfunnel.ai` |
| `apps/ui/admin` | **Pages** (static SPA) | The admin console for **DripFunnel staff**, managing every partner and platform (older docs: DF Admin) | `admin.dripfunnel.ai` |
| `apps/ui/mobile-app/merchant` | **Mobile app** (Expo; iOS and Android), one build per partner, built and submitted by hand, never by the pipelines (§6) | Merchants and vendors on their phones, in the partner's look; it calls `/api/` on the partner's portal host with a bearer token ([mobile-app/merchant/REACT-NATIVE.md](mobile-app/merchant/REACT-NATIVE.md) §5) | none of its own: the partner's portal host |
| `apps/ui/mobile-app/shop` *(proposed)* | **Mobile app** (Expo), one build per store, by hand | The store's customers: browse, buy, track a delivery ([mobile-app/shop/](mobile-app/shop/FIRST-RELEASE.md)) | none of its own: `/shop-api/` on `{slug}.<SHOP_DOMAIN>` |
| `apps/ui/mobile-app/delivery` *(proposed)* | **Mobile app** (Expo), one build per store, by hand | The store's riders: offers, pickup, delivery, cash on delivery ([mobile-app/delivery/](mobile-app/delivery/FIRST-RELEASE.md)) | none of its own: `/delivery-api/` on `{slug}.<SHOP_DOMAIN>` |
| `packages/storefront-core` | **Published package** (GitHub Packages) | The locked storefront core every storefront runs on, with the validator and gate suites. Store repos never install it: they pin a version, and the sandbox image for that version has it preinstalled (code/ARCHITECTURE.md §5) | none |
| `apps/sandbox` | **Container image**, one per core version: run in Cloudflare Containers by the API Worker's `StudioSession` Durable Object, and published on `ghcr.io` for store repos' builds, pulled with `GHCR_PULL_TOKEN` (#790) | A store's studio session (applying the AI's changes, the fast gate, the live frame) and, inside each store repo's workflow, every storefront build; Node, not the Workers runtime; no network, no credential | none |
| Store repos | **Public** GitHub repo per store, holding its published theme and one locked workflow that builds it inside `apps/sandbox`'s image (storefront/LIVE-SHOP.md §3–§4) | The store's live static build, uploaded to R2 and served by the edge Worker; its preview comes from the studio (storefront/PREVIEW.md) | `{slug}.my-store.one`; the merchant's own domain; preview on `{slug}-preview.my-store.one` |
| Postgres | **Neon** (dev: **PlanetScale**), via **Hyperdrive** | The system of record | none |
| R2 buckets | **R2** | Assets, imports and exports, invoices; storefront builds, previews and private drafts (storefront/LIVE-SHOP.md §2) | public assets through a custom domain with Cloudflare image resizing (decided 2026-10-05 on #337) |

**How the one Worker routes**, before any other code runs:

| Request | Handled by | Anywhere else |
|---|---|---|
| `admin.dripfunnel.ai/api/*` | Admin API (`src/apis/admin`) | 404 |
| `platform.dripfunnel.ai/api/*` | Platform API (`src/apis/platform`) | 404 |
| A registered portal host `/api/*` | Store API (`src/apis/store`); registered means a partner's `partner_domain` of kind `portal` that has gone live (`live`, `expiring` or `broken`), of a partner not closed (#288, #426). The found partner is kept in the data centre's cache (`caches.default`, keyed by the lower-cased host) for 60 s and a host not found is never kept, so a removed or no-longer-live domain, or a closed partner's, resolves for up to 60 s, as the edge lookup does (SAAS.md §8, #637). A partner's own host arrives only through store-proxy's service binding on the `PortalProxy` entrypoint; the Worker's own routes answer the Store API only on hosts in the admin host's zone (`dev-store.actuateminds.com` on dev, `store.northstar.localhost` locally) | 404 |
| A registered portal host `/api/v1/*` | The AI gateway (`src/apis/store/aiGateway.ts`, #950): REST, a store API key with `ai.run` only, never a cookie; SAAS §9.3 | 404 |
| A storefront host `/shop-api/*` | Shop API (`src/apis/shop`); through store-proxy's `StorefrontEdge` binding only `/shop-api/*` answers, and never on our own hosts (#317) | |
| `{slug}.<SHOP_DOMAIN>/delivery-api/*` and `/app/delivery.apk` | Delivery API (`src/apis/delivery`, built on #839), through store-proxy's `StorefrontEdge` binding only, which passes it on every store host as it does `/shop-api/*`; the Worker answers it only when the host is a store's free address, never on a preview host, a merchant's own domain, our hosts or its own routes ([api/DELIVERY.md](api/DELIVERY.md) §4) | 404 |
| `hooks.dripfunnel.ai/*` | Webhooks (`src/hooks`); `/builds/*`, a store repo's build calls by GitHub OIDC (`src/apis/builds.ts`, storefront/LIVE-SHOP.md §4, #517) | 404 |
| Queue messages, Cron, Workflow steps | `src/jobs` | no HTTP route |

`PortalProxy` answers only that row: our own hosts, any other path and a host not found are 404, and
nothing (not even `/api/health`) answers before the lookup. Public traffic can't reach an
entrypoint, so a forged `Host` on the Worker's own routes finds no partner (decided on #422).
A test proves every API answers 404 on every host it doesn't belong to. Cloudflare Access
guards `admin.dripfunnel.ai`. Prod deploys upload a Worker version without putting it live;
promoting it to 100% (and rolling back) is a manual `wrangler versions deploy` command, so a
bad deploy never reaches traffic without a human step (see `docs/code/ROLLBACK.md`).

**Routing check (settled 2026-10-01, #106):** a Worker route for `/api/*` can sit on the same
custom hostname as a Pages project. Confirmed on the dev account: `dev-admin`, `dev-platform`
and `dev-store` each answer `/api/health` with their own area while the SPA still serves on
the same host, so the Pages project and the Worker route co-exist. `apps/api/wrangler.jsonc`
declares the routes per environment (`apps/api/scripts/feature-env` does the same for feature
hostnames), so a fresh deploy reproduces them without dashboard-only state. The `/api/*`
pattern does not match the bare `/api` path, so every client must call `/api/` with the
trailing slash (`apps/ui/shared/graphql/client.ts`).

---

## 3. Repository layout

```
platform/
  apps/
    api/                    the one Worker: every API, webhooks, jobs, and all server code
    ui/
      store/                Pages SPA: merchants, their staff, vendors
      platform/             Pages SPA: Partners
      admin/                Pages SPA: DripFunnel staff (Admin)
      shared/               only code more than one SPA uses
      mobile-app/
        shared/             @dripfunnel/mobile-shared: the API client, format, intl, theme and secure storage the three apps use
        merchant/           Expo app: merchants and vendors on iOS and Android; shares no code with the SPAs
        shop/               Expo app: a store's customers, one build per store (proposed)
        delivery/           Expo app: a store's riders, one build per store (proposed)
    sandbox/                the container image for studio sessions and storefront builds
  packages/
    storefront-core/        the ONLY published package
  templates/
    storefront/             copied into each new store repo when its merchant picks a template;
                            themes/{key}/ holds the starting themes
  docs/                     laid out like the code; the map is docs/README.md
    README.md               the map, reading order, how to write docs
    ARCHITECTURE.md         this file
    USERS-AND-DOMAINS.md    users, sign-in hosts, onboarding, partner reach
    api/                    apps/api: README.md (guide), PLATFORM-PROMPT.md (engine),
                            ACCESS.md (identity and roles), SAAS.md (platform layer),
                            DATA-MODEL.md (tenancy, users, roles, RLS), LOGGING.md (activity log)
    ui/                     README.md (every SPA), then one folder per app:
      admin/                README.md, FIRST-RELEASE.md, CONSOLE-DESIGN.md,
                            CLAUDE-DESIGN-PROMPT.md and its -CUSTOMERS and -IMPERSONATION
      platform/             README.md, CLAUDE-DESIGN-PROMPT.md
      store/                README.md, DESIGN-BRIEF.md, CATALOG-DESIGN.md, OFFERS-DESIGN.md
      shared/               README.md
    mobile-app/             merchant/: the merchant mobile app (REACT-NATIVE.md, ARCHITECTURE.md,
                            DESIGN.md, CONFIGURATION.md, BUILDS-AND-STORE-ACCOUNTS.md, and more)
    code/                   ARCHITECTURE.md, DESIGN.md: repo-wide decisions and conventions
    storefront/             ARCHITECTURE.md, DESIGN.md: storefront template and AI design
  .github/workflows/        ci.yml (review, gates, naming in turn), naming.yml,
                            feature-env.yml, dev.yml, prod.yml
  .github/actions/          setup (pnpm, Node, install), naming, pages-deploy, worker-deploy,
                            worker-upload (prod: version upload, no live promotion)
  .changeset/               for storefront-core only
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  eslint.config.js
  AGENTS.md  CLAUDE.md  README.md
```

The tree inside `apps/api` is in [api/README.md](api/README.md), inside each SPA in
[ui/README.md](ui/README.md), and inside the published package in
[code/ARCHITECTURE.md](code/ARCHITECTURE.md) §5.

**Naming:** `store` and the Store API are the merchant's back office; the Shop API is what
customers use; a **store repo** is one merchant's generated storefront. "Merchant portal",
"platform console" and "admin console" in the docs mean `apps/ui/store`, `apps/ui/platform`
and `apps/ui/admin`.

**The merchant mobile app** (`apps/ui/mobile-app/merchant`, package `@dripfunnel/mobile-merchant`,
[mobile-app/merchant/](mobile-app/merchant/REACT-NATIVE.md)) is set up and holds placeholder
screens only (#496). Its folder layout is in
[mobile-app/merchant/ARCHITECTURE.md](mobile-app/merchant/ARCHITECTURE.md) §3. Its builds and
store submissions are manual, so the `dev` and `prod` pipelines (§6) never deploy it. Its dev
script is `start`, not `dev`, so `pnpm dev` doesn't start Metro; `pnpm dev:mobile` does.

---

## 4. Workers runtime: what the code must respect

All code in `apps/api` runs in the Workers runtime. **Verify each limit against Cloudflare's
current documentation before relying on it.**

- **No Node-only or native modules.** Use Web APIs (`fetch`, Web Crypto, streams) and the
  `nodejs_compat` flag only where it is supported. Password hashing uses a WebAssembly
  argon2id or another KDF that fits the CPU budget *(benchmark, then decide)*.
- **CPU time and memory per request are limited.** Keep request work small; move anything
  heavy (imports, exports, collection recomputation, bulk edits, provisioning) to Queues or
  Workflows.
- **Database access through Hyperdrive** with a Workers-compatible Postgres driver. No
  long-lived connections held by our code; transactions are per request. Row-level security
  settings are set per transaction (`SET LOCAL`).
- **No in-process state across requests.** Anything shared lives in Postgres, KV, Durable
  Objects or the cache. Caches are always keyed by tenant.
- **Bindings, not globals**: Hyperdrive, R2, Queues, Workflows, KV, rate limiters and
  secrets arrive through the Worker `env` and are passed into `createEngine(...)`. Nothing
  reads `process.env`.
- **Configuration** is validated from `env` once per isolate, failing the request loudly on a
  bad value.
- **Long-running and external work** (storefront builds, the AI designer's sandbox) doesn't
  run in Workers. The sandbox runs in **Cloudflare Containers** from `apps/sandbox`'s image,
  each store's held by a Durable Object (decided 2026-10-08 on #470); storefront builds run in
  each store repo's GitHub Actions inside the same image (decided 2026-10-09,
  storefront/LIVE-SHOP.md). Code in
  `apps/sandbox` is Node and may use Node modules; it never holds a secret, and the Worker
  makes every outside call (the model, GitHub, Cloudflare) on its behalf.

---

## 5. Data flow

```
store SPA (Pages) ─────/api──────▶ ┐
platform SPA (Pages) ──/api──────▶ │
Storefronts ───────────/shop-api─▶ ├─ apps/api (one Worker) ─┬─▶ Hyperdrive ─▶ Neon Postgres
Providers ─────────────hooks.────▶ │   store · platform ·    ├─▶ R2
outbox rows ─▶ Queues ───────────▶ ┘   shop · hooks · jobs   ├─▶ SES, Stripe, GitHub, Cloudflare APIs, AI models
                                                              └─▶ Durable Objects ─▶ Containers (apps/sandbox)
```

- Every write that has side effects writes **outbox rows in the same transaction**; a relay
  (a wake message per successful mutating request, Cron as the backstop) delivers them, so a rolled-back change never sends an email, webhook or
  cache purge.
- Workflows own multi-step jobs and record each step in the `job` table, so the platform
  console sees progress, errors and compensation.
- A store's studio session runs in a container that only its Durable Object talks to: the
  Worker sends it files and receives files and reports back; the container reaches nothing else
  (storefront/AI-STUDIO.md). A storefront build runs in the store repo's workflow with no secret but the image pull token (#790)
  and no network, and uploads through 15-minute credentials the API mints
  (storefront/LIVE-SHOP.md §4).

---

## 6. Environments and deploy

- **Environments**: local, feature (per `#<issue>/feature/<short-name>` branch), dev,
  production. Each has its own Worker, Pages deploys, R2 buckets, Queues and **database**: a Neon branch, or on dev a PlanetScale database.
  Feature environments live in a separate Cloudflare account and Neon project, on
  `actuateminds.com` ([code/FEATURE-ENVIRONMENTS.md](code/FEATURE-ENVIRONMENTS.md)).
- **Local**: `wrangler dev` for the API Worker with Hyperdrive pointed at the **local
  Postgres** (the local-databases-only rule), `vite dev` for the SPAs, Miniflare for R2,
  Queues and KV.
- **Pull requests and other branches**: the gates only; Turborepo builds and tests only what
  changed.
- **Feature branches**: every push deploys the branch's complete environment (Worker, three
  SPAs, Neon branch with migrations applied, `<slug>-*.actuateminds.com` hostnames behind
  Cloudflare Access). It is removed when the branch is deleted or after 14 days without a
  commit ([code/FEATURE-ENVIRONMENTS.md](code/FEATURE-ENVIRONMENTS.md)).
- **Dev**: one long-lived environment, redeployed on every push to `dev`, so both tracks
  see their work running against a real database instead of only locally. Same shape as
  production: migrations run first over Neon's direct connection, then the API Worker, then
  the three SPAs, each deploying only when its own files or `apps/ui/shared/` change. Hosts
  `dev-store.actuateminds.com`, `dev-platform.actuateminds.com`, `dev-admin.actuateminds.com` and
  `dev-hooks.actuateminds.com` (decided 2026-10-01; moved from `dripfunnel.ai` to `actuateminds.com` 2026-10-26): dev runs on
  the dev Cloudflare account, and that account holds `actuateminds.com`, not the production
  zone. Nothing that is not production belongs on the production domain. The dev account's
  Access applications are meant to cover these — `*.actuateminds.com` allows `@softobotics.com`,
  and `dev-hooks` matches the `*-hooks.actuateminds.com` Bypass, so providers' test webhooks
  reach it; webhooks verify their own signatures. `dev-hooks.actuateminds.com`'s DNS record and
  certificate are provisioned by its `custom_domain: true` route in `wrangler.jsonc`
  (`env.dev`), not by Access; the dashboard Access applications are what must gate the other
  three. Dashboard state that does not yet match this rule is tracked on #106, not here. A
  feature slug
  always begins with its issue number, so `dev-*` can never collide with one
  ([code/FEATURE-ENVIRONMENTS.md](code/FEATURE-ENVIRONMENTS.md)). Seeded once on first
  deploy; re-seeding is a manual `workflow_dispatch`, never automatic.
- **Production**: migrations from `apps/api/migrations` run first against Neon's direct
  connection (not Hyperdrive), and must be backward-compatible with the running version; then
  the API Worker version is uploaded — not deployed. Promotion to 100% and the SPA deploys are a
  separate, manual `workflow_dispatch` (`promote.yml`) run once the uploaded version is confirmed
  healthy: it promotes the Worker, runs one `wrangler deploy` of the same commit to apply the studio's
  container image (`versions deploy` can't, #881), health-checks the live prod host, and — only then — builds and
  deploys all three SPAs from that same commit, so the SPAs are never ahead of the API they call.
  See `docs/code/ROLLBACK.md`.
- **Pushing `main` is a production action**: it runs migrations against the real prod database
  and uploads a new Worker version, though nothing new goes live until `promote.yml` is run by
  hand. Treat a push to `main` accordingly.
- **`main` is not protected yet**: GitHub Free doesn't allow branch protection on private repos,
  so a direct push to `main` still deploys with no PR and no `ci.yml` run. Until the
  `dripfunnel` org is upgraded to GitHub Team and the `protect-main` ruleset is applied (pull
  requests only, the CI `gates` check must pass, no force-push or deletion), `prod.yml` runs its
  own `gates` job (build/typecheck/lint/test) before every deploy instead of relying on `main`
  being protected. Drop that job from `prod.yml` once the ruleset exists. The repo variable `GATES_CHECK=0` skips the gates in `ci.yml`, `dev.yml`, `prod.yml`, `feature-env.yml` and `release.yml`, and `prod.yml`'s deploy still runs, so a push to `main` then migrates prod and uploads a Worker version untested (#870). `GATES_CHECK=pr` skips only `ci.yml`'s pull-request `gates`: every push-triggered gate still runs (#961).

---

## 7. Observability and security

- **Activity log**: every write and sign-in at every level, shoppers included, in an
  append-only Postgres table, searchable per person in each console within its scope; 13
  months online, 7 years archived on R2 (api/LOGGING.md).
- Workers logs (not invocation logs or traces: they record URLs, and some carry a token; LOGGING §9) with request, partner, store and seller ids and no personal data;
  Logpush to long-term storage *(confirm destination)*; the platform metrics (build minutes, AI cost,
  provisioning success, time to first store).
- Secrets in Workers secrets (or Cloudflare Secrets Store), never in the repo or a bundle.
  The one Worker holds every secret, so each is scoped to the least the provider allows.
- Rate limiting with Workers rate-limit bindings and WAF rules on sign-in, signup, invites,
  password reset and the Shop API.
- Admin staff sign in with company SSO and 2-factor *(recommend Cloudflare Access in front
  of `admin.dripfunnel.ai` as an extra gate)*.
- **Fetching a URL a user gave us** (an import's image addresses, built on #301): https on a public
  name only, every address it resolves to public (through DoH, before the request and again for
  each redirect), a timeout, a size cap and bounded retries (`integrations/http/publicFetch.ts`).
  A Worker's `fetch` takes a URL, not an address, so it can't connect to the address that was
  checked: a name whose answer changes between the check and the request (DNS rebinding) is not
  stopped by the Worker itself. What bounds it is this deployment: the Worker has no private
  network attached (no Cloudflare Tunnel, VPC service or Hyperdrive to anything but Neon), and
  nothing internal listens on an address it can reach. **Adding any private network to the
  Worker makes this a real gap**: such a fetch would then have to connect to the checked
  address itself (`connect()` from `cloudflare:sockets`) or move behind an egress proxy.

---

## 8. Open questions

- ~~The Shop API hostname pattern for storefronts.~~ `/shop-api` on the store's own storefront hosts: `{slug}.<SHOP_DOMAIN>`, or its live custom
  domain. Previews are on `{slug}-preview.<SHOP_DOMAIN>` (`my-store.one` in prod; #744,
  USERS-AND-DOMAINS §2, replacing #518's `{key}.webpreview.store`): the store is the one whose
  `slug` is `{slug}`, checkout there is in test mode, and every caller is a guest. On
  any other host the public store key alone names the store, and a key sent on a store's own or
  preview host must be that store's (decided on #306).
- Password hashing choice under Workers CPU limits.
- Logpush destination, and whether to keep a copy of logs outside Cloudflare.
- ~~Where the AI designer's sandbox runs (GitHub Actions, Cloudflare Containers, or elsewhere).~~
  GitHub Actions (decided 2026-10-05 on #284); **Cloudflare Containers** (decided 2026-10-08 on
  #470, with storefront builds); storefront builds then moved to each store repo's GitHub
  Actions (decided 2026-10-09, storefront/LIVE-SHOP.md).
