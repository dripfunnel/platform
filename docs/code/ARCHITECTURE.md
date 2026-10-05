# ARCHITECTURE.md: code

The repo-wide code decisions: how the `platform` repo is split into workspaces, the one
published package and its releases, and the tooling every workspace shares. Companion:
[DESIGN.md](DESIGN.md) for how modules are written, in any app.

Each app's own structure lives with its guide: `apps/api` in [../api/README.md](../api/README.md),
the SPAs in [../ui/README.md](../ui/README.md). Deployables and hostnames:
[../ARCHITECTURE.md](../ARCHITECTURE.md). Storefront: `../storefront/ARCHITECTURE.md`.

**Status: skeleton.** Folders marked with a `.gitkeep` are empty placeholders.

Last updated: 2026-10-05.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **All server code lives in `apps/api`**, as folders, not packages | ~30 workspace packages in 8 layers | One Worker uses it, so nothing needs a package boundary, a version or a build. Layers stay, as folders enforced by lint (../api/README.md §4). |
| **`apps/ui/shared/` only for code a second app needs**; today browser code the SPAs share | Shared packages in advance | No speculative sharing. Code moves into `shared/` the moment a second app needs it, and not before. |
| **One published package, `@dripfunnel/storefront-core`**, because the AI edits store repos | Publishing SDKs, UI or tooling | It is the only code running outside this repo. It includes the Shop API client and the store repos' TypeScript and lint presets, so a store repo installs exactly one of our packages. |
| **`storefront-core` depends on nothing else in this repo** | Importing `shared/` | A published package can't depend on unpublished code. It carries its own small helpers; the duplication is deliberate and small. |
| **Apps talk to the API only through its GraphQL schemas**, generated into `apps/api/schema/*.graphql` and committed | Importing server types into clients | The SPAs and `storefront-core` type their operations from the schema files, so no client can pull in server code, and CI sees every schema change as a diff. |
| **Cross-layer imports in `apps/api` use `#layer/...` aliases** (`package.json` `imports`, e.g. `#core/config`); relative paths only inside a layer | Relative paths everywhere; TypeScript `paths` | Standard Node resolution that TypeScript, wrangler and Vitest all understand, and a lint rule can check the layer from the import alone. |
| **pnpm workspaces + Turborepo** | npm or Bun workspaces | Strict dependencies; only what changed is rebuilt and tested. pnpm runs install scripts only for packages listed in `allowBuilds` and refuses versions younger than its minimum release age. |
| **ESM only, TypeScript strict**; `apps/api` targets the **Workers runtime** (../ARCHITECTURE.md §4) | Node-only server code | The API runs on Cloudflare Workers. |
| **The engine is a module that the Worker composes** with `createEngine({ bindings, config })`, the way a headless engine library is bootstrapped by its server | The engine as its own service | Every entry point (the four APIs, webhooks, jobs, tests) uses the same engine instance per request. |

---

## 2. `apps/api`

Moved to [../api/README.md](../api/README.md): the APIs and who calls them (§2), the code
layout (§3), how a request flows (§5) and how to add code (§6).

---

## 3. Layers inside `apps/api`

Moved to [../api/README.md](../api/README.md) §4: the six layers, the import rules lint
enforces, and which layer a change goes in.

---

## 4. The SPAs and `apps/ui/shared/`

Moved to [../ui/README.md](../ui/README.md): the folder structure every SPA follows (§2),
API calls, text, navigation, states and how to add a screen. Each app's own guide is in
`../ui/<app>/README.md`, and `shared/` in [../ui/shared/README.md](../ui/shared/README.md).

The import rules stay repo-wide: `apps/ui/shared/` never imports from an app; nothing in
`shared/` or the SPAs imports `apps/api`; SPAs never import each other.

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
  package only. Provisioning grants that through the **GitHub App, per repository**; only if
  INF 0 finds that impossible does it push a read-only token as a repo secret (decided 2026-10-05 on #337).
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
| `apps/api`, `apps/ui/store`, `apps/ui/platform`, `apps/ui/admin` | Each builds and deploys on its own |
| `apps/ui/shared` | So the SPAs can depend on it and pnpm resolves its dependencies; no build |
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
