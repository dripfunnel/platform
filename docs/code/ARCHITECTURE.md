# ARCHITECTURE.md: code

How the code inside the `platform` repo is organised: the three apps, `shared/`, and the one
published package. Companion: [DESIGN.md](DESIGN.md) for how modules are written. Deployables
and hostnames: [../ARCHITECTURE.md](../ARCHITECTURE.md). Storefront: `../storefront/ARCHITECTURE.md`.

**Status: skeleton.** Folders marked with a `.gitkeep` are empty placeholders.

Last updated: 2026-09-27.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **All server code lives in `apps/api`**, as folders, not packages | ~30 workspace packages in 8 layers | One Worker uses it, so nothing needs a package boundary, a version or a build. Layers stay, as folders enforced by lint (§3). |
| **`shared/` only for code a second app needs**; today the browser code both SPAs use | Shared packages in advance | No speculative sharing. Code moves into `shared/` the moment a second app needs it, and not before. |
| **One published package, `@dripfunnel/storefront-core`**, because the AI edits store repos | Publishing SDKs, UI or tooling | It is the only code running outside this repo. It includes the Shop API client and the store repos' TypeScript and lint presets, so a store repo installs exactly one of our packages. |
| **`storefront-core` depends on nothing else in this repo** | Importing `shared/` | A published package can't depend on unpublished code. It carries its own small helpers; the duplication is deliberate and small. |
| **Apps talk to the API only through its GraphQL schemas**, generated into `apps/api/schema/*.graphql` and committed | Importing server types into clients | The SPAs and `storefront-core` type their operations from the schema files, so no client can pull in server code, and CI sees every schema change as a diff. |
| **Cross-layer imports in `apps/api` use `#layer/...` aliases** (`package.json` `imports`, e.g. `#core/config`); relative paths only inside a layer | Relative paths everywhere; TypeScript `paths` | Standard Node resolution that TypeScript, wrangler and Vitest all understand, and a lint rule can check the layer from the import alone. |
| **pnpm workspaces + Turborepo** | npm or Bun workspaces | Strict dependencies; only what changed is rebuilt and tested. pnpm runs install scripts only for packages listed in `allowBuilds` and refuses versions younger than its minimum release age. |
| **ESM only, TypeScript strict**; `apps/api` targets the **Workers runtime** (../ARCHITECTURE.md §4) | Node-only server code | The API runs on Cloudflare Workers. |
| **The engine is a module that the Worker composes** with `createEngine({ bindings, config })`, as Vendure's `@vendure/core` is bootstrapped by a server | The engine as its own service | Every entry point (the three APIs, webhooks, jobs, tests) uses the same engine instance per request. |

---

## 2. `apps/api`

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
                            sessions, memberships, roles, API keys, app grants, staff identity,
                            and resolving every caller into one TenantContext
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
                            storefront publishing, support access, audit log, ai-designer/
    apis/
      graphql/              Workers-compatible GraphQL server, scope.ts (per-resolver scope)
      store/                Store API: schema and resolvers per engine module
      platform/             Platform API: partners, merchants, plans, billing, fleet
      shop/                 Shop API: catalog, cart, checkout, account, content
    hooks/                  one file per provider: stripe.ts, razorpay.ts, shiprocket.ts, ses.ts, github.ts
    jobs/
      queues/               outbox-relay.ts, email.ts, search-index.ts, cache-purge.ts, import.ts
      workflows/            provision-store.ts, publish-storefront.ts, core-upgrade.ts
      cron.ts               automatic publish, cleanups
  schema/                   generated and committed: store.graphql, platform.graphql, shop.graphql
  migrations/               the single migration history: 0001_init.sql, ...
  tests/
    support/                Testcontainers Postgres, Workers test pool, factories, isolation
                            matrix helpers, fake payment and courier providers, clock control
    ...                     integration tests (unit tests sit beside the code)
  scripts/                  Node-only tooling (print-schema.ts), with its own tsconfig
  wrangler.jsonc            routes, bindings, queues, crons, workflows
  package.json              "imports": #core/*, #db/*, ... (one alias per folder)
```

---

## 3. Layers inside `apps/api`

```
6 entry points   apis/  hooks/  jobs/        (plus index.ts, router.ts)
5 saas           saas/
4 integrations   integrations/
3 engine         engine/
2 data/identity  db/  auth/
1 core           core/
```

- A folder imports only from its own layer or lower. `index.ts` and `router.ts` may import
  anything.
- Only `db/` touches tables, and tenant data only through `db/scoped/`.
- Integrations depend on the engine's interfaces (`definePaymentHandler`, …); the engine
  never imports an integration. The Worker registers them in `createEngine`.
- Each module is imported through its `index.ts`; no deep imports into another module.
- No cycles. Enforced by the eslint boundary rule and a dependency-graph check in CI.

---

## 4. The SPAs and `shared/`

```
apps/store/                 Pages SPA: merchants, staff, vendors
  src/
    main.tsx                mount, providers
    routes/                 TanStack Router file routes; each renders a feature screen
      __root.tsx
      _auth/                sign-in, sign-up, invitation, password reset
      _app/                 products/, orders/, offers/, customers/, storefront/, settings/, ...
    features/               screens per area
    api/                    Store API operations, typed from apps/api/schema/store.graphql
    brand/                  loads the partner's look for this hostname
    messages/               en.json, hi.json, ...
  index.html  vite.config.ts  package.json
apps/platform/              same shape; Platform API; DripFunnel look, no brand/

shared/                     used by both SPAs; browser-only
  ui/                       components, tokens, the designed-states helper (DESIGN §5)
  graphql/                  the client for /api: session cookie, CSRF, error codes, retries
  format/                   money, dates, numbers, addresses through Intl
  package.json              private "@dripfunnel/shared"; exports TypeScript source, no build
```

- `shared/` never imports from `apps/`. Nothing in `shared/` or the SPAs imports `apps/api`;
  they know the API only through its schema files.
- Something used by only one SPA stays in that SPA.

---

## 5. `packages/storefront-core` (published)

```
packages/storefront-core/
  src/
    platform/               api (the Shop API client), store, render, i18n, seo, analytics, consent
    cart/  checkout/  products/  collections/  search/
    account/  authentication/  orders/  pricing/
    ui/headless/            unstyled behaviour components
    contracts/              theme contract and route manifest
  presets/                  tsconfig.json, eslint.js: exported as ./tsconfig and ./eslint for store repos
  testing/                  the contract test suite, exported as ./testing
  package.json  CHANGELOG.md  README.md
```

Module details: `../storefront/ARCHITECTURE.md` §2.1. Its Shop API operations are typed from
`apps/api/schema/shop.graphql`.

**Releases**
- **Changesets** apply only here. A pull request that changes it needs a changeset with the
  bump and the reason; CI enforces it.
- **Semver means the public API**: removing or changing an export, a hook's behaviour, a
  contract, a preset rule or a supported Shop API version is a major.
- Merging to `main` updates a "Version packages" pull request; merging that publishes to
  GitHub Packages from the release workflow and tags the version.
- **Majors ship upgrade notes** for the fleet (`../storefront/ARCHITECTURE.md` §7) and
  declare the Shop API versions they support.
- **Deprecation**: `@deprecated` with the replacement, kept for at least one minor, removed in
  the next major.

**Access**
- Store repos (in the `dripfunnel` org, created by provisioning) get read access to this
  package only. **Verify that the GitHub API and the App's permissions let provisioning grant
  package access per repository**; otherwise push a read-only token as a repo secret.
- Store repos' `.npmrc`: `@dripfunnel:registry=https://npm.pkg.github.com`, token from the
  environment, never committed.
- Publishing only from the release workflow (`packages: write`), with artifact attestations.

**In this repo**, `templates/storefront` depends on it as `workspace:*`, so the template is
built and tested against the current source; provisioning writes the pinned published
version into each new store repo.

---

## 6. Workspaces and tooling

| Workspace | Why it has a `package.json` |
|---|---|
| `apps/api`, `apps/store`, `apps/platform` | Each builds and deploys on its own |
| `shared` | So the SPAs can depend on it and pnpm resolves its dependencies; no build |
| `packages/storefront-core` | Published |
| `templates/storefront` | Built and tested here like a real store repo |

Tooling is root files, not packages: `tsconfig.base.json` (each workspace extends it),
`eslint.config.js` (the custom rules: `apps/api` layers, raw table access only in `db/`, no
`process.env`, no default exports, nothing imports `apps/api`, `storefront-core` imports
nothing from the repo, no network calls or hard-coded commerce data in themes), `turbo.json`.

---

## 7. Open questions

- Package access for new store repos (§5).
- Whether merchants' developers get a published Shop API client later. Until then, they use
  the Shop API's GraphQL directly; the schema is the contract.
