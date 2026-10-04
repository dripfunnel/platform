# docs: the DripFunnel platform specification

Everything in this folder is the specification of the `platform` repo. Code follows the
docs; when they disagree, fix one of them in the same change and say which. This page is
the map: what each document is for, what to read for a task, and how to write docs here.

Last updated: 2026-10-04.

---

## 1. The platform in one paragraph

DripFunnel is a multi-tenant, white-label commerce platform built on **our own headless
engine**. **Partners** resell it under their own brand (DripFunnel is the house partner);
their **merchants** each get a store, a merchant portal in the partner's look, and a
storefront designed by an AI; merchants can invite **vendors** (suppliers) who see only
their own; **shoppers** buy on the storefronts. DripFunnel **staff** run everything from an
admin console. One API Worker serves everything; three static SPAs and the storefronts are
its clients; everything runs on Cloudflare, with Postgres on Neon.

---

## 2. The portals at a glance

| Portal | App | Host | Users and roles | API | Guide |
|---|---|---|---|---|---|
| **Admin console** | `apps/ui/admin` | `admin.dripfunnel.com` | DripFunnel staff: Super admin, Partner manager, Support, Finance, Engineer on call, Read-only | Admin API | [ui/admin/](ui/admin/README.md) |
| **Partner console** | `apps/ui/platform` | `platform.dripfunnel.com` | Partner users: Owner, Admin, Support, Finance, Read-only | Platform API | [ui/platform/](ui/platform/README.md) |
| **Merchant portal** | `apps/ui/store` | each partner's portal host, e.g. `store.<partnerdomain>` | Merchant Owner, Manager, Staff; vendors: Stock only, Products and stock, Products, stock and their orders | Store API | [ui/store/](ui/store/README.md) |
| **Storefront** | one repo per store, from `templates/storefront` + `@dripfunnel/storefront-core` | `{shop}.preview.<partnerdomain>`, `{shop}.shops.<partnerdomain>`, the merchant's domain | Shoppers | Shop API | [storefront/](storefront/ARCHITECTURE.md) |

All four APIs live in one Worker, `apps/api`: [api/](api/README.md).

---

## 3. The map

The folders mirror the code: `docs/api` ↔ `apps/api`, `docs/ui/<app>` ↔ `apps/ui/<app>`,
`docs/storefront` ↔ `templates/storefront` and `packages/storefront-core`. `docs/code` holds
what applies across the whole repo.

```
docs/
  README.md                 this map
  ARCHITECTURE.md           WINS: deployables, hostnames, routing, repo layout, Workers rules, data flow, deploy
  USERS-AND-DOMAINS.md      WINS: the five kinds of user, hostnames, onboarding, partner reach, support access, DNS
  api/
    README.md               guide: the four APIs and callers, apps/api layout, layers, how to add code, testing
    PLATFORM-PROMPT.md      spec: the engine (tenancy, identity, commerce modules, public APIs, jobs), open questions
    ACCESS.md               spec: identity, sessions, roles and permissions for every portal, invitations, vendors, support access, authorization checks
    DATA-MODEL.md           spec: tenancy tree, table scopes, users and roles in every pool, supplier teams, row-level security, the commerce tables (§7)
    LOGGING.md              spec: the activity (audit) log at every level, who sees what, search by person, retention
    SAAS.md                 spec: partners, merchant accounts, provisioning, plans, billing, domains, publishing, fleet, metrics
  ui/
    README.md               guide: how every SPA is built (structure, API calls, text, navigation, states, adding a screen)
    admin/README.md         guide: the admin console: purpose, staff roles, navigation, code, rules
    admin/FIRST-RELEASE.md  what the admin console's first release contains: Dashboard, Partners, Stores and the menus to manage them
    admin/CONSOLE-DESIGN.md design prompt: every admin console part, with its partner-console counterpart
    admin/CLAUDE-DESIGN-PROMPT.md   design prompt for a Claude Design session: the first release's screens
                            (with -CUSTOMERS.md and -IMPERSONATION.md for those two features)
    platform/README.md      guide: the partner console: purpose, partner roles, navigation, code, rules
    platform/FIRST-RELEASE.md  what the partner console's first release contains: every screen the prototype draws, and what the Platform API needs for them
    platform/CLAUDE-DESIGN-PROMPT.md  design prompt for a Claude Design session: the partner console
    store/README.md         guide: the merchant portal: purpose, roles and permissions, navigation, code, rules
    store/FIRST-RELEASE.md  what the merchant portal's first release contains, what the Store and Shop APIs need, and the cards that build it
    store/DESIGN-BRIEF.md   design prompt: the portal's facts, users and every flow
    store/CATALOG-DESIGN.md design prompt: the catalogue in depth
    store/OFFERS-DESIGN.md  design prompt: offers in depth
    shared/README.md        guide: @dripfunnel/shared, what belongs in it
  code/
    ARCHITECTURE.md         repo-wide: workspace decisions, storefront-core package and releases, tooling
    DESIGN.md               repo-wide: how modules, config, errors, tenancy data and UI components are written
    THIRD-PARTY-ACCESS.md   every third-party account, token and key: owner, scope, where kept, when needed, lead times
    FEATURE-ENVIRONMENTS.md a complete, separate environment per `feature` branch: design, lifecycle, one-time setup, limits
    GITHUB-MCP.md           connect Claude Code to GitHub (issues, project cards, pull requests) with a personal token
    HOW-TO-WORK-A-CARD.md   the loop a developer repeats for every card: read it, branch, work with Claude, gates, pull request, review
    WORKFLOW.md             how work is planned, named (#<issue>/<kind>/<name>, #<issue> commits), enforced, reviewed, merged
    ROLLBACK.md             rolling back a bad prod deploy: API Worker, SPAs, a bad migration
  storefront/
    ARCHITECTURE.md         the storefront template, storefront-core, render modes, AI loop, fleet upgrades
    DESIGN.md               what the AI may design and the rules every design keeps
```

**Outside `docs/`, at the repo root, is [`designs/`](../designs/design.md)**: one clickable
prototype per portal, plus a pricing page and the style guide. All dummy data, no backend.
Open the entry file in a browser.

| File | Is | For |
|---|---|---|
| `designs/DF Store Prototype.dc.html` | Merchant portal | `apps/ui/store` |
| `designs/DF Platform Prototype.dc.html` | Partner console | `apps/ui/platform` |
| `designs/DF Admin Prototype.dc.html` | Admin console | `apps/ui/admin` |
| `designs/DF Store Pricing.dc.html` | Public pricing page: the plans, what each one includes, the feature comparison, FAQ, month/year toggle | Plan limits and entitlements ([api/SAAS.md](api/SAAS.md)), and any screen that gates a feature by plan |
| `designs/DripFunnel Style Guide.dc.html` | The brand specimen: colour, type, buttons, forms, cards, badges, icons, light and dark | The `--df-*` tokens in `apps/ui/shared/ui/tokens.css` |

[`designs/design.md`](../designs/design.md) maps every screen to its file.
[`MISSING-FEATURES.md`](../designs/MISSING-FEATURES.md) and
[`INCOMPLETE-FEATURES.md`](../designs/INCOMPLETE-FEATURES.md) say what the prototypes leave
out or leave half-done — read the relevant entry before building a screen, so you don't
implement a dead end.

**Precedence**: `ARCHITECTURE.md` and `USERS-AND-DOMAINS.md` win wherever another document
disagrees. Then the specs (`api/*.md`, `storefront/ARCHITECTURE.md`), then the guides, then
the design prompts.

**The prototypes and the docs answer different questions** (decided 2026-09-29). `docs/`
decides **scope and rules**: what is in a release, who may see it, what the server enforces.
The prototype decides **behaviour**: layout, states, interactions, wording, and the order of
steps in a flow. So when a prototype shows a screen this release doesn't include, the doc
wins and the screen waits; when a screen is in the release, it is built to match the
prototype. If the prototype and a doc disagree about *behaviour*, ask — don't pick one.

---

## 4. What to read

**New to the repo (person or AI agent)**: this page, `ARCHITECTURE.md`,
`USERS-AND-DOMAINS.md`, then `../AGENTS.md` (the rules for working here),
`code/WORKFLOW.md` (branches, pull requests, review) and
`code/HOW-TO-WORK-A-CARD.md` (the loop for one card), then the guide for the part you'll
touch.

| Task touches | Read |
|---|---|
| Any server code | [api/README.md](api/README.md), [code/DESIGN.md](code/DESIGN.md) |
| Engine, commerce modules, public APIs | [api/PLATFORM-PROMPT.md](api/PLATFORM-PROMPT.md) |
| Sign-in, sessions, roles, permissions, invitations, vendors, support access | [api/ACCESS.md](api/ACCESS.md) |
| Tables, tenancy, where users and roles are stored, row-level security, the commerce tables | [api/DATA-MODEL.md](api/DATA-MODEL.md) |
| Partners, plans, billing, provisioning, domains, publishing, fleet | [api/SAAS.md](api/SAAS.md), and `designs/DF Store Pricing.dc.html` for what each plan includes |
| Activity log, who did what, technical logs | [api/LOGGING.md](api/LOGGING.md) |
| Any SPA code | [ui/README.md](ui/README.md), then the app's guide, then the screen in its prototype ([../designs/design.md](../designs/design.md)) |
| Merchant portal screens | [ui/store/](ui/store/README.md), [FIRST-RELEASE](ui/store/FIRST-RELEASE.md) (build this first), [DESIGN-BRIEF](ui/store/DESIGN-BRIEF.md), [CATALOG-DESIGN](ui/store/CATALOG-DESIGN.md), [OFFERS-DESIGN](ui/store/OFFERS-DESIGN.md), and `designs/DF Store Prototype.dc.html` |
| Partner console screens | [ui/platform/](ui/platform/README.md), [FIRST-RELEASE](ui/platform/FIRST-RELEASE.md) (build this first), [CONSOLE-DESIGN](ui/admin/CONSOLE-DESIGN.md) "Partner console" lines, and `designs/DF Platform Prototype.dc.html` |
| Admin console screens | [ui/admin/](ui/admin/README.md), [FIRST-RELEASE](ui/admin/FIRST-RELEASE.md) (build this first), [CONSOLE-DESIGN](ui/admin/CONSOLE-DESIGN.md), and `designs/DF Admin Prototype.dc.html` |
| Shared UI, tokens, formatting | [ui/shared/](ui/shared/README.md), and `designs/DripFunnel Style Guide.dc.html` for the tokens themselves |
| Storefront template, `storefront-core`, AI design | [storefront/ARCHITECTURE.md](storefront/ARCHITECTURE.md), [storefront/DESIGN.md](storefront/DESIGN.md), [code/ARCHITECTURE.md](code/ARCHITECTURE.md) §5 |

---

## 5. Kinds of document

| Kind | Examples | Holds | Written for |
|---|---|---|---|
| **Guide** (`README.md` in a folder) | `api/README.md`, `ui/store/README.md` | What the thing is, who uses it, roles, structure, rules, how to add to it; links to the specs | Anyone about to change that part |
| **Spec** | `ARCHITECTURE.md`, `ACCESS.md`, `SAAS.md`, `PLATFORM-PROMPT.md` | Decisions (with the rejected alternative and why), requirements, open questions | Anyone designing or reviewing |
| **Design prompt** | `CONSOLE-DESIGN.md`, `DESIGN-BRIEF.md`, `CATALOG-DESIGN.md`, `OFFERS-DESIGN.md` | A pasteable §1 prompt for a design session, vocabulary, facts, roles, parts or flows with numbered scenarios, states, never-do rules | A design session (human or AI), and the screens built from it |

---

## 6. How to write docs here

- **Update the doc in the same change as the code** it describes. A change that contradicts
  a doc either fixes the doc or is wrong.
- **Record decisions as a table**: decision | rejected | why. Don't relitigate a recorded
  decision without saying so.
- **Mark what isn't settled**, never invent an answer:
  - *(ask)*: a product question for the user;
  - *(confirm)*: a proposed answer awaiting a yes;
  - *(decide)*: an engineering choice still to make;
  - *(proposed)*: written down, not yet agreed;
  - *(release: decide)*: an engine requirement whose release is undecided.
  Each document keeps its open questions in its last section.
- **Section numbers, fact numbers, flow numbers and part letters are stable**: others cite
  them ("CATALOG-DESIGN §3 fact 16", "flow 58", "part L"). Never renumber; retire an item
  with a note instead.
- **Cite as `DOC §N`** and link with relative paths.
- **One home per fact.** Say a thing once, in the most specific document, and link to it.
  Guides summarise and link; they don't copy specs.
- **Plain words**; "Last updated: YYYY-MM-DD" under the title of every spec and guide.

---

## 7. The first platform

The first version of the platform was built on a third-party commerce framework. Everything
in its documents that
still holds was ported here on 2026-09-28: AUTH-PLAN and its ARCHITECTURE §4 into
`api/ACCESS.md`, SAAS-PLAN into `api/SAAS.md`, DESIGN-BRIEF, CATALOG-DESIGN-PROMPT and
OFFERS-DESIGN-PROMPT into `ui/store/`. Its repository was then removed from the workspace
and is **not a reference any more**. Citations such as "the first platform's AUTH-PLAN §8.5"
are history, kept to explain a decision; this repo's documents are the only source.
