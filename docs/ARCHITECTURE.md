# ARCHITECTURE.md: platform

How the whole DripFunnel platform is laid out and deployed. **This document wins where an
older one disagrees**: `api/PLATFORM-PROMPT.md`, `code/ARCHITECTURE.md`,
`storefront/ARCHITECTURE.md` and `ui/admin/CONSOLE-DESIGN.md` were written before some of the
decisions in §1 and are being brought in line.

**Status: skeleton.** The layout below exists and passes every gate; no features yet.

Last updated: 2026-09-30.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Five kinds of user and their hostnames**: Admin on `admin.dripfunnel.com`; Partners on `platform.dripfunnel.com`; merchants and vendors on each partner's own portal host; customers on merchants' domains. Full detail in [USERS-AND-DOMAINS.md](USERS-AND-DOMAINS.md) | Per-partner consoles; one shared merchant portal host; Admin and Partners in one console | Partners are our customers and use one console we own; merchants see only their partner's brand. Staff get their own console and host, so an Admin screen or endpoint can never be reached from a partner session, and Cloudflare Access can guard the whole admin host. |
| **One repo, `dripfunnel/platform`**, for every app, the storefront package and template, and all docs | Four repos (packages, store, admin, template) | One schema and one migration history for one database; an AI agent (or a person) can follow a change from table to API to screen and make it in one pull request; one copy of the rules. Generated **store repos** stay separate by design. |
| **Four apps**: `api` (one Worker) and three SPAs in `apps/ui/`: `store`, `platform` and `admin` | Five API Workers; a package per concern | Fewest moving parts: one API deploy, one config, one set of bindings, no wiring copied between Workers. The modules inside `api` stay separate, so splitting a Worker out later is cheap. |
| **One API Worker** serves the Store, Platform, Admin and Shop APIs, webhooks, queues, Cron and Workflows, choosing by hostname and path (§2) | A Worker per API | Simpler. Its costs are covered: a bad deploy is limited by manual promotion and instant rollback, and a hostname guard with a test keeps each API off hosts it doesn't belong on. |
| **Only code the AI could reach is a published package**: `@dripfunnel/storefront-core`, installed by store repos | Publishing shared internal code | Store repos are the only code outside this repo, and the AI edits them. The core they run must be versioned and outside the files the AI may change. Our own apps ship from one commit and need no versions. |
| **`apps/ui/shared/` holds only code that more than one app uses**, today browser code the SPAs share | Shared packages in advance | Nothing is shared before a second app needs it. Server code lives only in `apps/api`, so it can't leak into a browser bundle. |
| **UIs are independent static SPAs on Cloudflare Pages** | Next.js servers that also host the API | A UI deploy can't break the API and the reverse; UIs are pure static assets served from the edge; any client (the SPAs, integrations) uses the same APIs. |
| **The SPAs are built with Vite, React and TanStack Router** | Next.js static export | A pure client-side app: fast builds, no server features to avoid, typed routes and search params. Next.js stays only in the storefront template, which needs static generation. |
| **The API runs on Cloudflare Workers** | Containers on AWS | The same edge platform as the UIs and storefronts; no servers to run; scales per request. The cost is Workers' runtime constraints (§4). |
| **The API is served at `/api` on each UI's own hostname** (a Worker route), including partners' custom domains | A separate `api.` host; one central API domain | Same origin: `httpOnly` session cookies stay first-party, no CORS, one hostname per partner. |
| **Postgres on Neon, reached through Cloudflare Hyperdrive** | Cloudflare D1; AWS RDS | Keeps Postgres features the design relies on (row-level security, `SKIP LOCKED`, JSONB, full-text search). Neon adds a database branch per feature environment. The one part of the platform not on Cloudflare. |
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
| `apps/api` | **Worker** (one) | Store API, Platform API, Admin API, Shop API, inbound webhooks; queue consumers, Workflows, Cron | `/api/*` on every portal host, on `platform.dripfunnel.com` and on `admin.dripfunnel.com`; `/shop-api/*` on every storefront host; `hooks.dripfunnel.com` |
| `apps/ui/store` | **Pages** (static SPA) | Merchant and vendor portal, in the partner's look | Each partner's portal host (e.g. `store.<partnerdomain>`), chosen by the partner |
| `apps/ui/platform` | **Pages** (static SPA) | The platform console for **Partner** users | `platform.dripfunnel.com` |
| `apps/ui/admin` | **Pages** (static SPA) | The admin console for **DripFunnel staff**, managing every partner and platform (older docs: DF Admin) | `admin.dripfunnel.com` |
| `packages/storefront-core` | **Published package** (GitHub Packages) | The locked storefront core every store repo installs | none |
| Store repos | GitHub repo per store, built by Actions | The store's storefront: preview SPA and live SSG on Cloudflare (`storefront/ARCHITECTURE.md` §4) | `{shop}.preview.<partnerdomain>`; `{shop}.shops.<partnerdomain>`; the merchant's own domain |
| Postgres | **Neon**, via **Hyperdrive** | The system of record | none |
| R2 buckets | **R2** | Assets, imports and exports, invoices | public assets through a custom domain with image resizing *(confirm)* |

**How the one Worker routes**, before any other code runs:

| Request | Handled by | Anywhere else |
|---|---|---|
| `admin.dripfunnel.com/api/*` | Admin API (`src/apis/admin`) | 404 |
| `platform.dripfunnel.com/api/*` | Platform API (`src/apis/platform`) | 404 |
| A registered portal host `/api/*` | Store API (`src/apis/store`) | |
| A storefront host `/shop-api/*` | Shop API (`src/apis/shop`) | |
| `hooks.dripfunnel.com/*` | Webhooks (`src/hooks`) | 404 |
| Queue messages, Cron, Workflow steps | `src/jobs` | no HTTP route |

A test proves every API answers 404 on every host it doesn't belong to. Cloudflare Access
guards `admin.dripfunnel.com`. Prod deploys upload a Worker version without putting it live;
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
  packages/
    storefront-core/        the ONLY published package
  templates/
    storefront/             copied into each new store repo by provisioning
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
    code/                   ARCHITECTURE.md, DESIGN.md: repo-wide decisions and conventions
    storefront/             ARCHITECTURE.md, DESIGN.md: storefront template and AI design
  .github/workflows/        ci.yml (the gates), naming.yml, claude-review.yml,
                            feature-env.yml, dev.yml, prod.yml
  .github/actions/          setup (pnpm, Node, install), pages-deploy, worker-deploy,
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
  run in Workers. Builds run in the store repo's GitHub Actions; where the AI agent runs is
  still open (`api/PLATFORM-PROMPT.md` §10).

---

## 5. Data flow

```
store SPA (Pages) ─────/api──────▶ ┐
platform SPA (Pages) ──/api──────▶ │
Storefronts ───────────/shop-api─▶ ├─ apps/api (one Worker) ─┬─▶ Hyperdrive ─▶ Neon Postgres
Providers ─────────────hooks.────▶ │   store · platform ·    ├─▶ R2
outbox rows ─▶ Queues ───────────▶ ┘   shop · hooks · jobs   └─▶ SES, Stripe, GitHub, Cloudflare APIs
```

- Every write that has side effects writes **outbox rows in the same transaction**; a relay
  (Cron plus Queues) delivers them, so a rolled-back change never sends an email, webhook or
  cache purge.
- Workflows own multi-step jobs and record each step in the `job` table, so the platform
  console sees progress, errors and compensation.

---

## 6. Environments and deploy

- **Environments**: local, feature (per `#<issue>/feature/<short-name>` branch), dev,
  production. Each has its own Worker, Pages deploys, R2 buckets, Queues and **Neon branch**.
  Feature environments live in a separate Cloudflare account and Neon project, on
  `dripfunnel.ai` ([code/FEATURE-ENVIRONMENTS.md](code/FEATURE-ENVIRONMENTS.md)).
- **Local**: `wrangler dev` for the API Worker with Hyperdrive pointed at the **local
  Postgres** (the local-databases-only rule), `vite dev` for the SPAs, Miniflare for R2,
  Queues and KV.
- **Pull requests and other branches**: the gates only; Turborepo builds and tests only what
  changed.
- **Feature branches**: every push deploys the branch's complete environment (Worker, three
  SPAs, Neon branch with migrations applied, `<slug>-*.dripfunnel.ai` hostnames behind
  Cloudflare Access). It is removed when the branch is deleted or after 14 days without a
  commit ([code/FEATURE-ENVIRONMENTS.md](code/FEATURE-ENVIRONMENTS.md)).
- **Dev**: one long-lived environment, redeployed on every push to `dev`, so both tracks
  see their work running against a real database instead of only locally. Same shape as
  production: migrations run first over Neon's direct connection, then the API Worker, then
  the three SPAs, each deploying only when its own files or `apps/ui/shared/` change. Hosts
  `dev-store.dripfunnel.ai`, `dev-platform.dripfunnel.ai`, `dev-admin.dripfunnel.ai` and
  `dev-hooks.dripfunnel.ai` (decided 2026-10-01, correcting `dripfunnel.com`): dev runs on
  the dev Cloudflare account, and that account holds `dripfunnel.ai`, not the production
  zone. Nothing that is not production belongs on the production domain. The dev account's
  Access applications are meant to cover these — `*.dripfunnel.ai` allows `@softobotics.com`,
  and `dev-hooks` matches the `*-hooks.dripfunnel.ai` Bypass, so providers' test webhooks
  reach it; webhooks verify their own signatures. `dev-hooks.dripfunnel.ai`'s DNS record and
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
  healthy: it promotes the Worker, health-checks the live prod host, and — only then — builds and
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
  being protected. Drop that job from `prod.yml` once the ruleset exists.

---

## 7. Observability and security

- **Activity log**: every write and sign-in at every level, shoppers included, in an
  append-only Postgres table, searchable per person in each console within its scope; 13
  months online, 7 years archived on R2 (api/LOGGING.md).
- Workers logs and traces with request, partner, store and seller ids and no personal data;
  Logpush to long-term storage *(confirm destination)*; the platform metrics (build minutes, AI cost,
  provisioning success, time to first store).
- Secrets in Workers secrets (or Cloudflare Secrets Store), never in the repo or a bundle.
  The one Worker holds every secret, so each is scoped to the least the provider allows.
- Rate limiting with Workers rate-limit bindings and WAF rules on sign-in, signup, invites,
  password reset and the Shop API.
- Admin staff sign in with company SSO and 2-factor *(recommend Cloudflare Access in front
  of `admin.dripfunnel.com` as an extra gate)*.

---

## 8. Open questions

- The Shop API hostname pattern for storefronts.
- Password hashing choice under Workers CPU limits.
- Logpush destination, and whether to keep a copy of logs outside Cloudflare.
- Where the AI designer's sandbox runs (GitHub Actions, Cloudflare Containers, or elsewhere).
