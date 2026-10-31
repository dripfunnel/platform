# ARCHITECTURE.md: code

The repo-wide code decisions: how the `platform` repo is split into workspaces, the one
published package and its releases, and the tooling every workspace shares. Companion:
[DESIGN.md](DESIGN.md) for how modules are written, in any app.

Each app's own structure lives with its guide: `apps/api` in [../api/README.md](../api/README.md),
the SPAs in [../ui/README.md](../ui/README.md). Deployables and hostnames:
[../ARCHITECTURE.md](../ARCHITECTURE.md). Storefront: `../storefront/ARCHITECTURE.md`.

**Status: skeleton.** Folders marked with a `.gitkeep` are empty placeholders.

Last updated: 2026-10-31 (#1065: dev builds are `0.4.0-dev.<run>` since core 0.4.0, §5). Before: 2026-10-27 (the template's token-free `.npmrc` for a store repo's local install, §5). Before: 2026-10-22 (five APIs with the Delivery API, proposed). Before: 2026-10-18 (#790: the private ghcr package and its pull token, the dev studio image, §5). Before: 2026-10-12 (#485: release notes carry the codemods). Before: 2026-10-11 (#482: the release workflow builds, pushes and records the sandbox image).
Before: 2026-10-09 (the sandbox image published on `ghcr.io` for store builds, public then; private with a pull token since #790).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **All server code lives in `apps/api`**, as folders, not packages | ~30 workspace packages in 8 layers | One Worker uses it, so nothing needs a package boundary, a version or a build. Layers stay, as folders enforced by lint (../api/README.md §4). |
| **`apps/ui/shared/` only for code a second app needs**; today browser code the SPAs share | Shared packages in advance | No speculative sharing. Code moves into `shared/` the moment a second app needs it, and not before. |
| **One published package, `@dripfunnel/storefront-core`**, because the AI writes store repos' themes | Publishing SDKs, UI or tooling | It is the only code running outside this repo. It includes the Shop API client, the sealed components, the store repos' TypeScript and lint presets, the validator and the gate suites (`./guard`), so a store's theme depends on exactly one of our packages. |
| **`storefront-core` depends on nothing else in this repo** | Importing `shared/` | A published package can't depend on unpublished code. It carries its own small helpers; the duplication is deliberate and small. |
| **Apps talk to the API only through its GraphQL schemas**, generated into `apps/api/schema/*.graphql` and committed | Importing server types into clients | The SPAs and `storefront-core` type their operations from the schema files, so no client can pull in server code, and CI sees every schema change as a diff. |
| **Cross-layer imports in `apps/api` use `#layer/...` aliases** (`package.json` `imports`, e.g. `#core/config`); relative paths only inside a layer | Relative paths everywhere; TypeScript `paths` | Standard Node resolution that TypeScript, wrangler and Vitest all understand, and a lint rule can check the layer from the import alone. |
| **pnpm workspaces + Turborepo** | npm or Bun workspaces | Strict dependencies; only what changed is rebuilt and tested. pnpm runs install scripts only for packages listed in `allowBuilds` and refuses versions younger than its minimum release age. |
| **ESM only, TypeScript strict**; `apps/api` targets the **Workers runtime** (../ARCHITECTURE.md §4) | Node-only server code | The API runs on Cloudflare Workers. |
| **The engine is a module that the Worker composes** with `createEngine({ bindings, config })`, the way a headless engine library is bootstrapped by its server | The engine as its own service | Every entry point (the five APIs, webhooks, jobs, tests) uses the same engine instance per request. |

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
    platform/               api (the Shop API client), store, render, i18n, seo, analytics,
                            consent, media (Image, Video, fonts), browser (the hooks themes may use)
    cart/  checkout/  products/  collections/  search/
    account/  authentication/  orders/  pricing/
    ui/headless/            unstyled behaviour components
    sealed/                 the sealed components (closed Shadow DOM)
    contracts/              theme contract, route manifest, routes.json schema
    guard/                  the validator and the gate suites, exported as ./guard
    testing/                the contract checks, exported as ./testing
  presets/                  tsconfig.json, eslint.js: exported as ./tsconfig and ./eslint (the sandbox's
                            typecheck and lint; the validator in guard/ is what decides)
  package.json  CHANGELOG.md  README.md
```

Module details: `../storefront/ARCHITECTURE.md` §2.1. Its Shop API operations are typed from
`apps/api/schema/shop.graphql`.

**Releases**
- **Changesets** apply only here. A pull request that changes it needs a changeset with the
  bump and the reason; CI enforces it.
- **Semver means the public API**: removing or changing an export, a hook's behaviour, a
  contract, a preset rule or a supported Shop API version is a major.
- **A release is a card.** Its pull request runs `pnpm changeset version` on its own
  `#<issue>/task/release-core-<version>` branch, which consumes the pending changesets, bumps
  the version and writes the changelog, and goes through review, gates and naming like any
  other (decided on #303's review: a bot-opened "Version packages" pull request can't be
  created under the `branch-names` ruleset, and CI never runs on it, so it could never merge).
- **Publishing** (`.github/workflows/release.yml`, built on #303): every push to `main` runs
  core's gates; if core's version isn't on GitHub Packages yet, the workflow packs core once
  (`scripts/release/publish.mjs`), attests that tarball, then publishes **the same file** and
  tags it `@dripfunnel/storefront-core@<version>` on the commit whose change set that version (a missing
  tag is added on a later run; only the current version is checked, so a version bumped again
  before its tag landed stays untagged and is tagged by hand).
  A failed attestation publishes nothing, and `0.0.0`, the version before the first release
  card, is never published.
- **Dev channel** (#761): every push to `dev` publishes `<version>-dev.<run number>` under the `dev` dist-tag
  (`main` publishes under `latest`). The stamp is written inside the run only; a dev build gets no git tag,
  no `core_release` row, only its ghcr.io build image (store repos' builds pull it, LIVE-SHOP §4 step 5) and a tag in dev's Cloudflare registry, whose newest digest dev.yml writes into `env.dev`'s `containers` entry at deploy (#790). Dev builds are the one exception to the `0.0.0` rule: the tag is
  `<version>-dev.<run>` (`0.0.0-dev.<run>` until the first release card, `0.4.0-dev.<run>` since core 0.4.0).
- CI's `changesets` job (`scripts/release/changesets.mjs`) fails a pull request that changes
  `packages/storefront-core` (its changelog aside) without adding a changeset naming the
  package. Two kinds pass without one: a release PR (a new version, the changelog heading
  `## <version>` for it, and the core changesets it consumed deleted) and a promotion into `main`
  carrying such a version and heading. Deleting or hand-bumping never stands in for a changeset,
  and renames count as a delete and an add.
- **Majors ship upgrade notes** for the fleet (`../storefront/ARCHITECTURE.md` §7) and
  declare the Shop API versions they support. Any release that changes something for themes adds its entry to
  `coreUpgradeNotes`, with its codemods, in the release card (`../storefront/ARCHITECTURE.md` §7.1, #485).
- **Deprecation**: `@deprecated` with the replacement, kept for at least one minor, removed in
  the next major.

**Access**
- **Store repos never install it** (decided 2026-10-08 on #470): every build and every AI
  change runs in the **sandbox image** for the store's core version (`apps/sandbox`), which
  the release workflow's `sandbox-image` job builds after publishing and pushes to Cloudflare's registry (studios)
  and to `ghcr.io` as `ghcr.io/dripfunnel/storefront-build:<version>` (store repos' builds on GitHub
  Actions log in with the organisation secret `GHCR_PULL_TOKEN` to pull it, decided on #790; before that the package was to be
  public, decided 2026-10-09, `../storefront/LIVE-SHOP.md` §4), then records its
  Cloudflare digest in `core_release` (built on #482; old versions' images are retired by AI-STUDIO §9's rule, and
  `.github/workflows/retire-images.yml` deletes them from Cloudflare's registry, #485), with core, the allowed libraries
  and the gate tools preinstalled. A store repo's `package.json` only pins the version, which
  picks the image. No store repo holds an `.npmrc` with a token: the template's `.npmrc` names only the registry, for a
  person running a clone locally with their own `read:packages` token in `~/.npmrc`. The one secret store repos read is `GHCR_PULL_TOKEN`, a read-only
  `read:packages` organisation secret for the image pull (decided on #790, which brings back the org secret #470 replaced).
- Publishing only from the release workflow (`packages: write`), with artifact attestations.

**In this repo**, `templates/storefront` depends on it as `workspace:*`, so the template and
its starting themes are built and tested against the current source; the platform writes the
pinned published version into each new store repo.

---

## 6. Workspaces and tooling

| Workspace | Why it has a `package.json` |
|---|---|
| `apps/api`, `apps/ui/store`, `apps/ui/platform`, `apps/ui/admin` | Each builds and deploys on its own |
| `apps/ui/shared` | So the SPAs can depend on it and pnpm resolves its dependencies; no build |
| `packages/storefront-core` | Published |
| `templates/storefront` | Built and tested here like a real store repo, with each starting theme |
| `apps/sandbox` | The container image for studio sessions and storefront builds: Node, not the Workers runtime (../ARCHITECTURE.md §4) |

Tooling is root files, not packages: `tsconfig.base.json` (each workspace extends it),
`eslint.config.js` (the custom rules: `apps/api` layers, raw table access only in `db/`, no
`process.env`, no default exports, nothing imports `apps/api`, `storefront-core` imports
nothing from the repo), `turbo.json`. A theme's own rules are not lint: they are core's
validator (`./guard`, ../storefront/ARCHITECTURE.md §3.4), which the sandbox runs on every AI
change and every build.

---

## 7. Open questions

- ~~Package access for new store repos (§5).~~ None needed: builds run in the sandbox image (decided 2026-10-08 on #470).
- Whether merchants' developers get a published Shop API client later. Until then, they use
  the Shop API's GraphQL directly; the schema is the contract.
