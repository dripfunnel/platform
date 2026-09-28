# AGENTS.md: platform

The whole DripFunnel platform in one repo: one API Worker (`apps/api`: the commerce engine,
the Store, Platform, Admin and Shop APIs, webhooks and background jobs on Queues, Workflows and
Cron), three static SPAs on Cloudflare Pages in `apps/ui/` (`store` for merchants and
vendors, `platform` for Partners, `admin` for DripFunnel staff), the one published package (`storefront-core`) and
the storefront template every store's own repo is created from. Postgres on Neon via
Hyperdrive; files on R2.

**Status: skeleton.** The apps, `apps/ui/shared/`, `storefront-core` and the template build and pass
every gate; no database, business logic or features yet.

## Read first

Start with [docs/README.md](docs/README.md) (the map), then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/USERS-AND-DOMAINS.md](docs/USERS-AND-DOMAINS.md). Those two win wherever another
document disagrees. Then open only the part your task touches:

| Task touches | Read |
|---|---|
| Any code in `apps/api`: APIs, callers, layout, layers, how to add code | [docs/api/README.md](docs/api/README.md) |
| Engine, commerce modules, public APIs | [docs/api/PLATFORM-PROMPT.md](docs/api/PLATFORM-PROMPT.md) |
| Identity, sessions, roles and permissions, invitations, vendors, support access | [docs/api/ACCESS.md](docs/api/ACCESS.md) |
| Partners, merchant accounts, provisioning, plans, billing, domains, publishing, fleet | [docs/api/SAAS.md](docs/api/SAAS.md) |
| Any SPA: structure, API calls, text, navigation, states, adding a screen | [docs/ui/README.md](docs/ui/README.md) |
| Merchant portal (`apps/ui/store`) | [docs/ui/store/](docs/ui/store/README.md) and its DESIGN-BRIEF, CATALOG-DESIGN, OFFERS-DESIGN |
| Partner console (`apps/ui/platform`) | [docs/ui/platform/](docs/ui/platform/README.md) |
| Admin console (`apps/ui/admin`) | [docs/ui/admin/](docs/ui/admin/README.md) and its CONSOLE-DESIGN |
| `apps/ui/shared` | [docs/ui/shared/](docs/ui/shared/README.md) |
| Repo-wide conventions, workspaces, `storefront-core` releases | [docs/code/DESIGN.md](docs/code/DESIGN.md), [docs/code/ARCHITECTURE.md](docs/code/ARCHITECTURE.md) |
| Storefront template, `storefront-core`, AI design | [docs/storefront/ARCHITECTURE.md](docs/storefront/ARCHITECTURE.md), [DESIGN.md](docs/storefront/DESIGN.md) |

`../df-store-archived/` is history: everything in it that still holds is ported into
`docs/` (docs/README.md §7). Don't take a Vendure fact from it.

Read-only references outside this repo: `../vendure-backend/`, `../community-plugins/`,
`../vendure-storefront-template/`, `../df-store-archived/`. Never edit them.

## Commands

```bash
pnpm install
pnpm turbo run build typecheck lint test         # every gate, only what changed
pnpm --filter ./apps/api dev                     # wrangler dev
pnpm --filter ./apps/ui/<app> dev                # vite dev (store, platform, admin)
pnpm --filter ./apps/api schema                  # regenerate apps/api/schema/*.graphql
pnpm changeset                                   # required when storefront-core changes
```

Planned, not yet present: `test:integration` (Testcontainers Postgres + Workers test pool),
`test:e2e`, and `pnpm --filter ./apps/api migrate` (LOCAL database only).

Run the gates before reporting a change as done.

## Where things go

- **`apps/api`** holds all server code, in layered folders; a folder imports only from its
  own layer or lower (docs/api/README.md §4).
- **`apps/ui/store`, `apps/ui/platform`, `apps/ui/admin`** are browser apps. They know the API only through its
  generated schema files (`apps/api/schema/`), never by importing `apps/api`.
- **`apps/ui/shared/`** holds only code more than one SPA uses. Add to it when a second app needs something,
  never in advance; something one app uses stays in that app.
- **`packages/storefront-core`** is the only published package. It imports nothing from
  the rest of the repo.
- **`templates/storefront/`** is copied into each new store repo by provisioning. Commerce
  logic belongs in `storefront-core`, never in the template.
- **`docs/`** is the specification, laid out like the code (docs/README.md §3). Update the
  relevant document in the same change as the code it describes, following docs/README.md §6.

## Area rules

**The API Worker (`apps/api`)**
- Code runs in the Workers runtime: no Node-only or native modules, no `process.env`
  (bindings arrive through `env` and are passed in), no state kept between requests.
- Heavy or multi-step work goes to Queues or Workflows, never a long request.
- Database access only through `src/db` over Hyperdrive, tenant data only through
  `src/db/scoped`; migrations only in `apps/api/migrations`.
- The router decides by hostname first: each API answers 404 on hosts it doesn't belong to
  (docs/ARCHITECTURE.md §2). A schema change regenerates `apps/api/schema/` in the same change.

**The SPAs (`apps/ui/store`, `apps/ui/platform`, `apps/ui/admin`)**
- Static SPAs with no server code. They talk only to their API at `/api` on the same
  hostname, through `@dripfunnel/shared/graphql`.
- Every portal screen renders in its partner's look (white label) using `shared/ui`
  tokens. The consoles at `platform.dripfunnel.com` and `admin.dripfunnel.com` are
  DripFunnel-branded for every user.
- The console at `platform.dripfunnel.com` (`apps/ui/platform`) serves Partner users only;
  the console at `admin.dripfunnel.com` (`apps/ui/admin`) serves DripFunnel staff only, and
  never shares screens or endpoints with the partner console. Both are separate from
  merchant identity. A partner sees only its own merchants, at account level, and enters a
  merchant's portal only through audited, consented, read-only support access. Every console
  write is audited with the actor, target and reason; destructive actions restate their
  consequence.
- Never display a secret, full card number, password or token.

**Storefronts (`templates/storefront`, `packages/storefront-core`)**
- In generated store repos the AI designer may change **only `src/theme/**`**: look, not
  logic. No network calls, third-party scripts or unlisted dependencies in themes.
- No invented data: no hard-coded products, prices, stock, discounts, ratings, reviews,
  badges or scarcity claims.
- Required components (price with tax label, payment element, legal and compliance
  notices, consent banner, preview banner, the brand's "Powered by" line) are styled, never
  removed.
- `storefront-core` is the only published package. Every change has a changeset with the
  right bump; changing or removing an export is a major, and majors ship upgrade notes (docs/storefront/ARCHITECTURE.md §7).
- Publishing happens only in the release workflow. Never publish locally; never commit a
  token to `.npmrc`.

**Deploys**
- Pushing `main` deploys production. Treat it as a production action.

## Rules

### Working with the user

1. **Ask before assuming.** At the start of every new request, check whether anything is
   unclear, contradictory, or not decided by the docs. If so, ask before writing code or
   documents. Explain each question properly:
   - what is undecided, and where you looked;
   - why it matters (what changes depending on the answer);
   - the realistic options, each with its consequence;
   - your recommendation, and why.

   Don't ask what the code or the docs already answer, and don't ask to confirm what the
   user just said.
2. **Never commit, branch or push unless asked in that same message.** Finish the work,
   leave it in the working tree, and say what is ready. "Keep going" is not permission.
3. **Local databases only.** Nothing in development points at `dbpg01.softobotics.org`
   (dev or prod) until the user says otherwise.
4. **Report what is true.** Say which commands you ran and what they returned. Compiling is
   not verification. If a check fails, say so; never weaken, skip or delete a test to make
   it pass.
5. **The docs are the specification.** Follow what they decide. When they are wrong, fix
   the document in the same change and say so.

### Code

1. **Reusable first.** Before writing anything, look for it in the app's own modules and in
   `apps/ui/shared/`. Logic needed by more than one app belongs in `shared/`, never copied between
   apps. Extract a shared function or component once the same logic appears a second time,
   not in anticipation of it.
2. **No unnecessary comments.** Names and types say what the code does. Comment only *why*,
   when it isn't obvious: a constraint, an invariant, a workaround (with a link to the issue
   or doc). No comments that restate the code, no commented-out code, no change-history
   comments, no `TODO` without an issue link.
3. **Small and focused.** One responsibility per module and function; names that state
   intent; no dead code, unused exports or speculative options.
4. **TypeScript strict.** No `any`, no non-null assertions to silence the compiler, no
   `@ts-ignore` without a linked reason. Validate every input that crosses a trust boundary
   with zod and derive its type from the schema.
5. **Respect boundaries.** Follow the layer and import rules (docs/api/README.md §4); they are
   enforced by lint and tests, and a change that needs to break one is a design discussion.
6. **Consistent style.** Formatting and lint come from the root `eslint.config.js` and
   `tsconfig.base.json`; don't add local overrides.

### SaaS platform rules

**Tenancy and access**
- Every read and write of tenant data goes through the scoped data layer with a
  `TenantContext`. Never take a store, seller or brand id from the client as authority.
- Authorise every operation on the server. Hiding a button is not access control. Plan
  limits and entitlements are enforced on the server too.
- A vendor never sees the merchant's or another vendor's data; a store never sees another
  store's; a brand never sees another brand's. That includes counts, search results, empty
  states, exports, logs shown to users and error messages.
- Least privilege for roles, API keys, app grants and service credentials.

**Security**
- No secrets in code, repositories, images, client bundles, logs or error messages.
  Configuration is validated at boot and the process exits on a bad value.
- Validate all input and reject unknown fields. Parameterised queries only. Encode output.
  CSRF protection for cookie sessions. SSRF protection on every user-supplied URL
  (webhooks, imports, image fetches). Rate-limit authentication and public endpoints.
- Never reveal whether an account or email exists.
- Audit every privileged or destructive action with the real actor, target and reason.

**Data**
- Money is integer minor units with a currency. Never floats, never a bare number.
- Store timestamps in UTC; convert only for display, naming the time zone.
- Migrations are reviewed SQL, backward-compatible with the previous release, and never
  destroy data without a written plan.
- Keep personal data to the minimum, never log it, and support export and deletion
  requests (GDPR, DPDP and similar).
- Soft-delete where history matters (orders, audit, billing).

**Reliability**
- Webhooks, jobs and payment operations are idempotent (idempotency keys, deduplication).
- Every outbound call has a timeout; retries use backoff and a limit.
- Side effects of a change (emails, webhooks, indexing, cache purges) go through the outbox,
  so a rolled-back transaction never triggers them.
- Every list is paginated with a maximum page size; no N+1 queries; indexes exist for the
  filters list screens use.
- Cache keys always include the tenant (and language, currency, seller where relevant).
- When a third party is down, show a clear state and keep the data; never lose work.

**Product**
- No hard-coded user-facing text: messages per locale. Numbers, money, dates and addresses
  are formatted with `Intl` and the store's settings, never with a country assumption.
- Accessibility is WCAG 2.2 AA.
- Every screen designs its empty, loading, error, permission-denied and read-only states.
- Public APIs stay backward-compatible; a breaking change needs a major version and
  migration notes.
- Risky changes ship behind feature flags that can target a brand, plan or store.

**Observability**
- Structured logs carry the request, brand, store and seller ids, with error codes, and
  no personal data.
- Emit the platform metrics (build minutes, AI cost, provisioning success, time to first
  store) where the work happens.

**Testing**
- Write tests with the code, not after. Test against real infrastructure (Postgres via
  Testcontainers), not mocks of our own data layer.
- Any endpoint touching tenant data is covered by the isolation matrix (caller kind ×
  store × seller).

**Dependencies**
- Add a dependency only with a stated reason, never one that duplicates an existing one.
  The lockfile is committed. Known critical vulnerabilities fail the build.
