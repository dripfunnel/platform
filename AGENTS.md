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
| Tables, tenancy tree, users and roles storage, row-level security | [docs/api/DATA-MODEL.md](docs/api/DATA-MODEL.md) |
| Partners, merchant accounts, provisioning, plans, billing, domains, publishing, fleet | [docs/api/SAAS.md](docs/api/SAAS.md) |
| Activity (audit) log, technical logs, anything users can search about who did what | [docs/api/LOGGING.md](docs/api/LOGGING.md) |
| Any SPA: structure, API calls, text, navigation, states, adding a screen | [docs/ui/README.md](docs/ui/README.md) |
| Merchant portal (`apps/ui/store`) | [docs/ui/store/](docs/ui/store/README.md) and its DESIGN-BRIEF, CATALOG-DESIGN, OFFERS-DESIGN |
| Partner console (`apps/ui/platform`) | [docs/ui/platform/](docs/ui/platform/README.md) |
| Admin console (`apps/ui/admin`) | [docs/ui/admin/](docs/ui/admin/README.md), its FIRST-RELEASE (what to build now) and CONSOLE-DESIGN |
| `apps/ui/shared` | [docs/ui/shared/](docs/ui/shared/README.md) |
| Repo-wide conventions, workspaces, `storefront-core` releases | [docs/code/DESIGN.md](docs/code/DESIGN.md), [docs/code/ARCHITECTURE.md](docs/code/ARCHITECTURE.md) |
| Creating a card (task, bug or feature) on the DF Platform board | [docs/code/HOW-TO-WRITE-A-CARD.md](docs/code/HOW-TO-WRITE-A-CARD.md) |
| Running locally, setting up or deploying an environment | [docs/setup/](docs/setup/local.md): local, dev, prod |
| Merchant mobile app (`apps/ui/mobile-app/merchant`, planned) | [docs/mobile-app/merchant/](docs/mobile-app/merchant/REACT-NATIVE.md): start with REACT-NATIVE, then DESIGN and ARCHITECTURE |
| Storefront template, `storefront-core`, AI design | [docs/storefront/ARCHITECTURE.md](docs/storefront/ARCHITECTURE.md), [DESIGN.md](docs/storefront/DESIGN.md) |
| Storefront builds, hosting, preview, the studio's sandbox | [docs/storefront/LIVE-SHOP.md](docs/storefront/LIVE-SHOP.md), [PREVIEW.md](docs/storefront/PREVIEW.md), [AI-STUDIO.md](docs/storefront/AI-STUDIO.md) |

The first platform's documents are ported into `docs/` and its repositories are gone;
`docs/` is the only specification (docs/README.md §7).

## Commands

```bash
pnpm install
pnpm setup:local                                 # once: install, check, migrate and seed locally
pnpm turbo run build typecheck lint test         # every gate, only what changed
pnpm dev                                         # the four apps: the Worker and the three SPAs,
                                                 # after checking the local setup
pnpm dev:https                                   # the same behind https://admin.localhost and
                                                 # https://platform.localhost (needs Caddy)
pnpm dev:all                                     # those plus the storefront template and
                                                 # storefront-core rebuilding on change
pnpm dev:<api|store|platform|admin>              # one of the four on its own
pnpm dev:storefront                              # the storefront template (builds core first)
pnpm dev:storefront-core                         # storefront-core rebuilding on change
pnpm --filter ./apps/api schema                  # regenerate apps/api/schema/*.graphql
pnpm changeset                                   # required when storefront-core changes
```

Planned, not yet present: `test:integration` (the local Postgres from docs/api/README.md §7,
a fresh database per run, plus the Workers test pool),
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
- **`templates/storefront/`** is copied into each new store repo when its merchant picks a
  template. Commerce logic belongs in `storefront-core`, never in the template or a theme.
  *Planned, not yet present*: `themes/` with the starting themes (#486).
- *Planned, not yet present*: **`apps/sandbox`**, the container image that will run AI changes
  in Cloudflare Containers (docs/storefront/AI-STUDIO.md; #482) and, published on `ghcr.io`,
  every store repo's build on GitHub Actions (docs/storefront/LIVE-SHOP.md). It is Node, holds
  no secret and reaches no network; the API Worker makes every outside call for it.
- **`docs/`** is the specification, laid out like the code (docs/README.md §3). Update the
  relevant document in the same change as the code it describes, following docs/README.md §6.
- **`designs/`** holds one clickable prototype per portal (`DF Store Prototype` →
  `apps/ui/store`, `DF Platform Prototype` → `apps/ui/platform`, `DF Admin Prototype` →
  `apps/ui/admin`), the shoppers' storefront (`DF Storefront Prototype` → the baseline theme
  in `templates/storefront`), the public pricing page with what each plan includes, and the style
  guide the `--df-*` tokens come from. `designs/design.md` maps every screen to its file.
  `docs/` decides scope and rules; the prototype decides behaviour — layout, states,
  interactions, wording, the order of steps in a flow.

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
- **Open the screen in its prototype before building it** (`designs/`, docs/ui/README.md
  §7 step 1), and check `designs/MISSING-FEATURES.md` and `designs/INCOMPLETE-FEATURES.md`
  so you don't implement a dead end.
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
- The AI designer writes **only a store's theme** (`src/theme/**`, `content/**`, `routes.json`),
  behind the walls of docs/storefront/ARCHITECTURE.md §3: look and front-end behaviour, never
  commerce. A wall is never loosened to let a change through: the validator, the gates, the
  sealed components and CSP change only in core, in this repo, by a person. No network calls,
  third-party scripts or unlisted dependencies in themes.
- No invented data: no hard-coded products, prices, stock, discounts, ratings, reviews,
  badges or scarcity claims.
- Sealed components (price with tax label, payment element, legal and compliance
  notices, consent banner, preview banner, the brand's "Powered by" line, breadcrumbs, the order
  summary at review) are placed and styled, never removed, covered or reworded.
- `storefront-core` is the only published package. Every change has a changeset with the
  right bump; changing or removing an export is a major, and majors ship upgrade notes (docs/storefront/ARCHITECTURE.md §7).
- Publishing happens only in the release workflow. Never publish locally; never commit a
  token to `.npmrc`.

**Deploys**
- Pushing `main` runs migrations against the real prod database and uploads a new Worker
  version — nothing goes live until `promote.yml` is run by hand (docs/ARCHITECTURE.md §6).
  Treat a push to `main` as a production action.

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
   When asked to branch or commit, follow [docs/code/WORKFLOW.md](docs/code/WORKFLOW.md) §2:
   branches are `#<issue>/<feature|task|bug>/<short-name>` (quoted in the shell; `feature`
   only for new feature development, since it deploys an environment), every commit message
   and pull request title starts with `#<issue> `, the issue must exist, and nothing is ever
   committed on or pushed to `main` or `dev`. Without an issue number, ask for one.
3. **Local databases only.** Nothing in development points at `dbpg01.softobotics.org`
   (dev or prod) until the user says otherwise.
   Exception: the merchant mobile app's `dev` profile targets `dev-store.dripfunnel.ai` (mobile-app/merchant/CONFIGURATION.md §2).
4. **Report what is true.** Say which commands you ran and what they returned. Compiling is
   not verification. If a check fails, say so; never weaken, skip or delete a test to make
   it pass.
5. **The docs are the specification.** Follow what they decide. When they are wrong, fix
   the document in the same change and say so.
6. **Build exactly what was asked; fix a bug with the smallest change.** Scope creep costs the
   reviewer and the user more than it saves (#421: a one-line rule bug grew a table, a flow and a
   screen, and was cut back to dropping the rule).
   - **A bug card fixes the bug, nothing else.** No new tables, migrations, endpoints, jobs,
     settings, screens or flows unless the bug cannot be fixed without them. Removing or
     correcting the broken rule is a fix; building a feature that would make the rule work is not.
   - **Before writing code, find the smallest fix** and say what it is. When the only fixes
     change behaviour, contradict a document, or need any of the additions above, ask first
     (rule 1), with the smallest option first and recommended, and each larger option naming
     what it adds (the tables, endpoints, screens, migrations), so the size is visible.
   - **Build what was chosen, as chosen.** Don't add extras on the way ("while I was there"),
     even small ones. Something else found along the way (a related bug, a display issue, a
     refactor, a better design) goes on its own card, reported in your reply, never into this
     card's PR.
   - **The same holds for tasks and features:** the card's Do list and Done-when are the scope.
     A step that grows past them (a new table, an API the card didn't name, a second screen) is
     a question for the user before it is code.
   - **When the user narrows the scope,** take out everything beyond it, including work already
     pushed, and say what was removed.
7. **Creating a card follows [docs/code/HOW-TO-WRITE-A-CARD.md](docs/code/HOW-TO-WRITE-A-CARD.md).**
   Ask every open question first, then show the whole draft and create it only after a yes. Every
   card has a complete "Prompt for Claude" and checkbox acceptance criteria. A bug card also has
   numbered steps to reproduce, with the expected and actual results.

### Code

1. **Reusable first.** Before writing anything, look for it in the app's own modules and in
   `apps/ui/shared/`. Logic needed by more than one app belongs in `shared/`, never copied between
   apps. Extract a shared function or component once the same logic appears a second time,
   not in anticipation of it.
   Exception: the merchant mobile app shares no code with the SPAs (mobile-app/merchant/REACT-NATIVE.md §2).
2. **No unnecessary comments.** Names and types say what the code does. Comment only *why*,
   when it isn't obvious: a constraint, an invariant, a workaround (with a link to the issue
   or doc). No comments that restate the code, no commented-out code, no change-history
   comments, no `TODO` without an issue link.
   **One or two lines.** Past three it is not a comment any more, and the explanation belongs
   somewhere it will be maintained: why the code changed goes in the **commit message**, how
   the system works goes in **`docs/`**, why a decision was taken goes on the **card**.
   **Cite a document, never summarise one** — `DATA-MODEL.md §5.2` beats a paragraph that
   will drift from it. A file whose comments explain its own history is one nobody will trust
   to be current.
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
- Log every write and sign-in, by every caller, in the activity log with the real actor,
  scope, target and reason (docs/api/LOGGING.md). Never put secrets or payloads in it.

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
- Write tests with the code, not after. Test against real infrastructure (the local Postgres
  from docs/api/README.md §7, a fresh database per run), not mocks of our own data layer.
  **No Docker**: the same rule as the development database (decided on #11, confirmed on #12).
- Any endpoint touching tenant data is covered by the isolation matrix (caller kind ×
  store × seller).

**Dependencies**
- Add a dependency only with a stated reason, never one that duplicates an existing one.
  The lockfile is committed. Known critical vulnerabilities fail the build.
