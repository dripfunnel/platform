# docs/api: the API Worker (`apps/api`)

The guide to `apps/api`: what each API is for, who may call it, how the code is laid out,
and how to add to it. Read [../ARCHITECTURE.md](../ARCHITECTURE.md) and
[../USERS-AND-DOMAINS.md](../USERS-AND-DOMAINS.md) first; they win wherever this folder
disagrees.

**Status: skeleton.** The router, the four GraphQL endpoints (one `health` field each), the
layer rules and a local Postgres with a migration runner and a `/health` DB check exist and
pass every gate. There is no engine or feature code yet.

Last updated: 2026-09-29.

| Document | Covers |
|---|---|
| This guide | The APIs, callers, code layout, layers, how to add code, testing |
| [PLATFORM-PROMPT.md](PLATFORM-PROMPT.md) | The engine specification: what carries over, what we now own, tenancy, commerce modules, public APIs, jobs, testing, open questions |
| [ACCESS.md](ACCESS.md) | Identity, sessions, roles and permissions for every portal, invitations, vendors, support access, the authorization checks |
| [DATA-MODEL.md](DATA-MODEL.md) | Tables: the tenancy tree and table scopes, every identity pool, roles and supplier teams, row-level security policies (commerce tables added per module) |
| [LOGGING.md](LOGGING.md) | The activity (audit) log at every level: what is recorded, the entry, who sees what, search by person, retention; and technical logs |
| [SAAS.md](SAAS.md) | The platform layer: partners, merchant accounts, provisioning, plans and entitlements, billing, domains, publishing, fleet, metrics |

---

## 1. What `apps/api` is

**One Cloudflare Worker** holds all server code: the commerce engine, the platform (SaaS)
layer, four GraphQL APIs, inbound webhooks, and background work on Queues, Workflows and
Cron. The SPAs and storefronts are clients of it; none of them contains business logic.

It follows the usual headless-commerce shape (an engine exposing a Shop API and an admin-side
API) but is multi-tenant, vendor-aware and white-label from the first line
(PLATFORM-PROMPT §5.10).

---

## 2. The APIs

The router picks the API **by hostname first**, then path. Every API answers 404 on hosts it
doesn't belong to, and a test proves it (`src/router.test.ts`, `src/index.test.ts`).

| API | Served at | Schema | Client | Who calls it | Scope of every operation |
|---|---|---|---|---|---|
| **Admin API** (`src/apis/admin`) | `admin.dripfunnel.com/api` | `schema/admin.graphql` | `apps/ui/admin` | DripFunnel staff (company SSO + 2FA) | The whole platform: every partner, every merchant account. Staff role decides what is allowed |
| **Platform API** (`src/apis/platform`) | `platform.dripfunnel.com/api` | `schema/platform.graphql` | `apps/ui/platform` | Partner users | **The caller's own partner only**, and its merchants at account level |
| **Store API** (`src/apis/store`) | `/api` on each partner's portal host | `schema/store.graphql` | `apps/ui/store`, integrations (API keys), installed apps | Merchants, their staff, vendors; API keys; apps; support sessions (read-only) | **The acting store**, and for vendors their own `seller_id` |
| **Shop API** (`src/apis/shop`) | `/shop-api` on each storefront host | `schema/shop.graphql` | `@dripfunnel/storefront-core`, merchants' own storefronts | Shoppers (public store key + optional customer session) | One store, public data only |
| Webhooks (`src/hooks`) | `hooks.dripfunnel.com` | none | Stripe, Razorpay, Shiprocket, SES, GitHub | Providers (signature verified) | Per provider event |

### 2.1 What belongs in which API

| Put it in | When the operation… | Examples |
|---|---|---|
| **Admin API** | spans partners, or is DripFunnel's decision | Approve or pause a partner; every store across partners; staff and staff roles; fleet rollouts; platform settings and ceilings; integration health; platform-wide activity log; partner (wholesale) billing as the biller |
| **Platform API** | is a partner managing itself or its merchants' accounts | Its branding, domains, email sender; its plans, prices and entitlements (within platform ceilings); its merchants' accounts, plans, trials, suspend and restore; its billing with DripFunnel as the payer; its team; start a support session |
| **Store API** | happens inside one store | Catalogue, stock, orders, customers, offers, storefront, settings, people and vendors, the store's own subscription |
| **Shop API** | a shopper or storefront needs it | Catalogue, search, cart, checkout, customer account, store content |

- **Never share a schema type between the Admin API and the Platform API** just because the
  data looks alike. Both call the same `saas/` services; the Platform API resolver always
  passes the caller's partner as the scope, the Admin API resolver passes the staff member's
  chosen target. Separate schemas are what stop a partner reaching a staff-only field.
- **Nothing above a store goes in the Store API**: partners, plans, billing between
  DripFunnel and partners, provisioning, staff (PLATFORM-PROMPT §5.5).
- **Nothing a shopper shouldn't see goes in the Shop API**, and no Shop API field returns a
  Store API type (PLATFORM-PROMPT §5.9).
- **Support access** is started from the Admin API (staff) or the Platform API (partner
  support) and then reads the merchant's store through the Store API as a read-only support
  caller (ACCESS.md §8). How the session reaches the partner's portal host is *(decide)*.

### 2.2 Callers

Every request resolves to one caller, and every caller resolves to one context before any
resolver runs. The full model is in [ACCESS.md](ACCESS.md) §3.

| Caller | API | Resolves to |
|---|---|---|
| Staff member | Admin | `StaffContext` (staff id, staff role) |
| Partner user | Platform | `PartnerContext` (user id, partner id, partner role) |
| Person in the portal | Store | `TenantContext` (acting store, `SellerScope`, permissions) from the session's membership set |
| Support session | Store | `TenantContext` with read-only permissions, the real actor recorded |
| API key | Store | `TenantContext` bound to its store (and seller, if vendor-bound), its scopes |
| Installed app | Store | `TenantContext` from its per-store grant and approved scopes |
| Shopper | Shop | Store from the public key or hostname, plus an optional customer session |

A caller never borrows another's power: an API key can't exceed its creator's role, and a
vendor's key never sees outside its `seller_id`.

---

## 3. Code layout

```
apps/api/
  src/
    index.ts                the Worker: fetch, queue, scheduled; exports the Workflow classes
    router.ts               hostname + path -> entry point; 404 anywhere else (../ARCHITECTURE.md §2)
    core/                   money, ids, errors (DfError), results, pagination, time, config
                            (env -> zod), logger and metrics, i18n and Intl formatting
    db/
      schema/               one file per area: saas.ts, auth.ts, catalog.ts, inventory.ts,
                            orders.ts, promotions.ts, outbox.ts, jobs.ts, ...
      scoped/               the scoped query layer every tenant read and write goes through
      rls/                  row-level security policies
      client.ts             Hyperdrive connection factory
    auth/                   users, password hashing, Google sign-in, verification codes,
                            sessions, memberships, roles, API keys, app grants, partner users,
                            staff identity, and resolving every caller into its context
    engine/
      index.ts              createEngine({ bindings, config })
      kernel/               event-bus/, jobs/, operations/, strategies/, custom-fields/
      modules/              one folder per area, each: index.ts, service.ts, events.ts, operations/
        catalog/  inventory/  pricing/  tax/  promotions/  cart/  orders/  payments/
        shipping/  customers/  search/  imports/  assets/
    integrations/
      payments/             stripe/, razorpay/, cashfree/
      couriers/             shiprocket/
      storage-r2/  search-postgres/  email-ses/  cloudflare/  github/
    saas/                   partners, merchants' accounts, plans and entitlements ("Publish now"
                            allowances, publish schedule), billing, provisioning, domains,
                            storefront publishing, support access, activity/ (the activity log), ai-designer/
    apis/
      graphql/              Workers-compatible GraphQL server (Yoga + Pothos), scope.ts
                            (per-resolver API, permission and scope declaration)
      admin/                Admin API, for DripFunnel staff
      platform/             Platform API, for partners
      store/                Store API: schema and resolvers per engine module
      shop/                 Shop API: catalog, cart, checkout, account, content
    hooks/                  one file per provider: stripe.ts, razorpay.ts, shiprocket.ts, ses.ts, github.ts
    jobs/
      queues/               outbox-relay.ts, email.ts, search-index.ts, cache-purge.ts, import.ts
      workflows/            provision-store.ts, publish-storefront.ts, core-upgrade.ts
      cron.ts               automatic publish, cleanups
  schema/                   generated and committed: admin, platform, store, shop .graphql
  migrations/               the single migration history: 0001_init.sql, ...
  tests/
    support/                Testcontainers Postgres, Workers test pool, factories, isolation
                            matrix helpers, fake payment and courier providers, clock control
    ...                     integration tests (unit tests sit beside the code)
  scripts/                  Node-only tooling (print-schema.ts), with its own tsconfig
  wrangler.jsonc            routes, bindings, vars (ADMIN_HOST, PLATFORM_HOST, HOOKS_HOST), queues, crons, workflows
  package.json              "imports": #core/*, #db/*, ... (one alias per folder)
```

Folders with only a `.gitkeep` today are placeholders for the tree above.

**Inside each API folder** (`apis/<api>/`), as it grows:

```
apis/store/
  schema.ts                 builds the API's schema from its area files; exported as storeSchema
  catalog.ts, orders.ts...  one file per engine module: types, queries, mutations
  context.ts                caller -> context resolution for this API (calls auth/)
```

A resolver is thin: validate input (zod), call one engine or `saas/` service with the
context, map the result. No SQL, no business rules, no provider calls in `apis/`.

---

## 4. Layers

```
6 entry points   apis/  hooks/  jobs/        (plus index.ts, router.ts)
5 saas           saas/
4 integrations   integrations/
3 engine         engine/
2 data/identity  db/  auth/
1 core           core/
```

- A folder imports only from its own layer or lower. `index.ts` and `router.ts` may import
  anything. Enforced by `eslint.config.js` (`apiLayers`).
- Cross-layer imports use the `#layer/...` aliases (`#core/config`); relative paths only
  inside a layer.
- Only `db/` touches tables, and tenant data only through `db/scoped/`.
- Integrations depend on the engine's interfaces (`definePaymentHandler`, …); the engine
  never imports an integration. The Worker registers them in `createEngine`.
- Each module is imported through its `index.ts`; no deep imports into another module.
- No cycles.

**Where does my change go?** In the lowest layer it belongs to:

| The change is… | Layer |
|---|---|
| A value type, error code, formatter, config field | `core/` |
| A table, index, query, RLS policy | `db/` (+ a migration) |
| Who someone is, sessions, roles, keys, caller resolution | `auth/` |
| A commerce rule (price, tax, stock, offer, order state) | `engine/modules/<module>` |
| A provider adapter (Stripe, Shiprocket, SES, GitHub, Cloudflare) | `integrations/` |
| Partners, plans, billing, provisioning, domains, publishing, support, audit | `saas/` |
| Exposing any of the above to a client | `apis/<api>/` |
| Receiving a provider callback | `hooks/` |
| Work that is slow, multi-step or scheduled | `jobs/` |

---

## 5. How a request flows

```
request ─▶ router.ts (host, path) ─▶ apis/<api> Yoga server
        ─▶ context: session / key / grant / staff ─▶ auth/ resolves the caller's context
        ─▶ resolver: declared API + permission + scope checked (apis/graphql/scope.ts)
        ─▶ engine or saas service (pure rules, events)
        ─▶ db/scoped with the context (store_id, seller_id applied; RLS as backstop)
        ─▶ outbox rows in the same transaction for any side effect
```

Side effects (emails, webhooks, search indexing, cache purges, builds) are never done in the
request. They are outbox rows, delivered by `jobs/queues/outbox-relay.ts` after commit.

---

## 6. How to add things

**A field or mutation to an API**
1. Decide the API (§2.1) and the lowest layer for the logic (§4).
2. Write or extend the service in `engine/` or `saas/`, with unit tests beside it.
3. Add the resolver in `apis/<api>/<area>.ts`, declaring its permission and tenant scope.
   A resolver without a declaration fails the structural test.
4. `pnpm --filter ./apps/api schema` and commit the changed `schema/*.graphql`.
5. Add the field to the isolation matrix if it touches tenant data (§9).

**An engine module**: a folder under `engine/modules/` with `index.ts` (the only public
entry), `service.ts`, `events.ts`, `operations/`. It registers its tables, operations and
event handlers with the engine; other modules use its `index.ts` and its events, never its
tables (PLATFORM-PROMPT §4, §5.10).

**A table**: schema in `db/schema/<area>.ts`, a reviewed SQL migration in `migrations/`,
backward-compatible with the running release. Declare the table's scope: platform, partner,
store, or store-and-seller. Tenant tables get `store_id` (and `seller_id` where vendors own
rows), RLS policies for its scope (DATA-MODEL.md §2, §5), and per-store unique constraints.

**An integration**: a folder in `integrations/` implementing an engine interface, with its
credentials passed in from `env` or the store's encrypted settings, a timeout on every call,
and retries with backoff. A fake of it goes in `tests/support/`.

**A job**: single-step work is a Queue consumer in `jobs/queues/`; multi-step work with
compensation is a Workflow in `jobs/workflows/`, recording each step in the `job` table so
the consoles can show progress; schedules go in `jobs/cron.ts`. Every handler is idempotent.

**A webhook**: one file per provider in `hooks/`: verify the signature, record the event id
for idempotency, write outbox rows or engine calls, return fast.

**A config value or binding**: add it to `core/config.ts` (zod) and `wrangler.jsonc`;
secrets through `wrangler secret`, never in the repo. Pass it into `createEngine`, never
read it from a global.

**A migration**: add a numbered file to `migrations/` (`0002_...sql`, next number after the
last one committed), reviewed SQL only, backward-compatible with the running release. Run
`pnpm --filter ./apps/api migrate` (needs `DATABASE_URL` in the environment, e.g. `set -a;
source .dev.vars; set +a`) to apply every pending file in order against your local database;
it refuses to run against anything but `localhost`/`127.0.0.1`/`::1` (AGENTS.md "Working
with the user" rule 3). Each file runs inside its own transaction, so statements that
cannot run in one (`create index concurrently`, `alter type ... add value`) must be their
own migration file with no other statements. Applied migrations are recorded in the
`schema_migrations` table so re-running is a no-op.

---

## 7. Local Postgres

This project requires Postgres 17.x; `pnpm migrate` refuses to run against any other major
(`scripts/migrate/version-check.ts`). Install it natively — no Docker required.

**macOS (Homebrew):**

```
brew install postgresql@17
brew services start postgresql@17
createuser -s dripfunnel_dev
createdb -O dripfunnel_dev dripfunnel
psql -d dripfunnel -c "alter user dripfunnel_dev with password 'dripfunnel_dev'"
```

**Debian/Ubuntu:**

```
sudo apt install postgresql-17
sudo -u postgres createuser -s dripfunnel_dev
sudo -u postgres createdb -O dripfunnel_dev dripfunnel
sudo -u postgres psql -c "alter user dripfunnel_dev with password 'dripfunnel_dev'"
```

**Windows:** install Postgres 17 with the postgresql.org installer, then run the equivalent
`createuser`/`createdb` commands from a shell (or pgAdmin) with the same names.

If port 5432 is already in use by another local Postgres, run the 17 instance on a different
port (e.g. `5434`) and change the port in the URLs below to match.

Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`; the default `DATABASE_URL` matches
the role, password, port and database name above. `wrangler dev` reads `.dev.vars` for worker
bindings; Node scripts and tests don't, so export it first:

```
cd apps/api
set -a; source .dev.vars; set +a
pnpm migrate
```

`.dev.vars` also needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (same
connection string as `DATABASE_URL`) — `wrangler dev --env local` uses it to make the `HYPERDRIVE`
binding proxy to local Postgres instead of a real Hyperdrive resource. Wrangler reads that
specific variable from the shell environment, not from `.dev.vars` directly, so `pnpm dev`
sources `.dev.vars` into the shell before starting wrangler; if you run `wrangler dev` by hand
instead of `pnpm dev`, export `.dev.vars` the same way first or it'll error asking for the
variable.

There's no equivalent step in production: `apps/api/wrangler.jsonc` has no top-level
`hyperdrive` binding yet. To provision one, run
`wrangler hyperdrive create <name> --connection-string="postgres://..."` and add the returned
id as `{ "binding": "HYPERDRIVE", "id": "<resource-id>" }` under `hyperdrive` in
`wrangler.jsonc`. Until that's done, `/health` reports `{ ok: true, db: "unconfigured" }`
rather than failing.

Migrations may declare `create extension if not exists "..."`; the runner checks every
required extension is installed on the server before applying anything
(`scripts/migrate/extensions.ts`) and fails with the missing extension's name and how to
install it (`postgresql-contrib` / `postgresql-contrib-17`) rather than partially applying.

This is local only (AGENTS.md "Working with the user" rule 3): nothing in
`.dev.vars.example` or `wrangler.jsonc` ever points at
`dbpg01.softobotics.org`.

`pnpm test` needs this same database up and `.dev.vars` exported (see above):
`scripts/health-check.test.ts`, `scripts/migrate/extensions.test.ts` and
`scripts/migrate/runner.test.ts` run against it via `DATABASE_URL` (falling back to the
default above when unset), the way CI's `postgres:17` service does
(`.github/workflows/ci.yml`).

`/health` is unauthenticated and opens a Hyperdrive connection per call, so it's rate-limited
(30/min per area, per IP, `HEALTH_RATE_LIMITER` in `wrangler.jsonc`) to stop a request storm
from exhausting Hyperdrive's connection pool. `cf-connecting-ip` is always set behind
Cloudflare; a request without it (only possible off Cloudflare, e.g. `wrangler dev`) gets
400 rather than falling back to an easily-exhausted shared bucket.

---

## 8. Rules that apply to every line in `apps/api`

The full list is [AGENTS.md](../../AGENTS.md) "SaaS platform rules" and
[../code/DESIGN.md](../code/DESIGN.md). The ones that decide the shape of API code:

- **Workers runtime**: no Node-only or native modules, no `process.env`, no state between
  requests; CPU-heavy or slow work goes to Queues or Workflows (../ARCHITECTURE.md §4).
- **Tenancy is structural**: every tenant read and write goes through `db/scoped` with a
  context; a store, seller or partner id from the client is never authority.
- **Every resolver declares** its API, permission and scope; `SellerScope` has no default.
- **Money** is `Money` (integer minor units + currency); timestamps are UTC.
- **Errors** are `DfError` with stable codes; expected outcomes are typed results, not
  throws; nothing internal leaks to a client.
- **Every write and sign-in is logged** in the activity log with the real actor, scope,
  target and reason, by the resolver's declaration, in the same transaction (LOGGING.md).
- **Public APIs stay backward-compatible**: the Shop API above all, since every storefront
  depends on it. Schema diffs are checked in CI.

---

## 9. Testing

- **Unit tests** beside the code (`service.test.ts`), for pure rules: money, tax,
  promotions, stock. Property-based where the input space is large.
- **Integration tests** in `tests/` against a real Postgres (Testcontainers) and the
  Workers test pool. No mocks of our own data layer. *(Planned: `test:integration`.)*
- **Isolation matrix**: every endpoint × caller kind × role × acting store × seller, with
  two partners, two stores and two vendors per test, including a person in two stores under
  two partners. Nothing may cross (ACCESS.md §11).
- **Structural tests**: every GraphQL field declares its API, permission and scope; only
  `db/scoped` touches tenant tables; no Shop API field returns a Store API type; each API
  answers 404 off its hosts (exists today).
- **Contract tests**: the storefront template runs the Shop API contract in CI; schema diffs
  fail on a breaking change.

Run `pnpm turbo run build typecheck lint test` before reporting any change as done.

---

## 10. Open questions

Carried from PLATFORM-PROMPT §10 where they decide API shape:

- Is the Platform API GraphQL like the others? *(Today all four are GraphQL; confirm.)*
- How a support session opened from the admin or partner console reaches the merchant's
  portal host (§2.1).
- Which of API keys, webhooks and apps ship first; API rate limits and quotas per plan.
