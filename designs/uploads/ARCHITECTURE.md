# ARCHITECTURE.md

How `df-store` — the DripFunnel merchant portal and its BFF — is built.

Sibling documents: [SAAS-PLAN.md](SAAS-PLAN.md) is *what* the platform becomes and in what order; [AUTH-PLAN.md](AUTH-PLAN.md) is the auth, role and vendor design this implements. **This document is the shape of the code**: processes, layers, data ownership, and the seams that keep tenants apart.

**Status: proposed. Nothing here is built yet.**

Last updated: 2026-09-13.

---

## 1. Decisions

Recorded so they are not relitigated. Alternatives were considered; the reason each lost is given.

| Decision | Rejected | Why |
|---|---|---|
| **Own Postgres database** for the BFF | A schema inside Vendure's DB; no DB at all | Keeps SAAS-PLAN's rule that Vendure owns all commerce data and nothing else does. Independent migrations, backups and blast radius. Same server initially, split later. |
| **Docker → ECR → host**, same as `vendure-backend` | Vercel; co-located with Vendure | One deployment story, one secret-handling story, no new vendor in the critical path. The BFF holds the service-account credential and the §5.4 proof secret — those stay on infrastructure we control. Cost: preview deploys must be built, not inherited. |
| **Client SPA + explicit BFF API** | Server Components + Server Actions | A testable, enumerable API surface that a future mobile or partner client can reuse. The cost is real and named: every endpoint is a place the tenant filter can be forgotten. §4 exists entirely to remove that possibility. |
| **Durable job table now, worker process later** | Worker + Redis from day one; synchronous | Provisioning needs rollback (SAAS-PLAN §8) and retry from the first tenant; a separate worker tier does not need to exist until AI runs do. §8 keeps the runner isolated so extracting it is a deploy change, not a rewrite. |
| **tRPC for the API surface** | Hand-rolled REST | One place where every procedure is declared, so scoping can be enforced by the procedure builder rather than by review (§4.2). End-to-end types against a schema that will churn. REST can be added later for external consumers. |
| **Drizzle ORM** | Prisma; TypeORM; Kysely | Pure TypeScript with no query-engine binary, which matters on `node:20-alpine` — Prisma needs musl-specific engine builds and carries them into the image. Drizzle generates **SQL migration files you review and commit**, which is what §10's backward-compatible-for-one-release rule actually depends on. Raw SQL is first-class, needed for the job poller's `SELECT … FOR UPDATE SKIP LOCKED` (§8) that Prisma only reaches through `$queryRaw`. TypeORM is what Vendure uses, but the team meets it *through* Vendure's services rather than writing migrations by hand, so that familiarity is thinner than it looks — and this database is deliberately not Vendure's (§6). Kysely was the close second; Drizzle wins by bringing migrations with it instead of needing a second tool. |
| **Vitest + Testcontainers**, Playwright for a thin E2E set | Jest; mocked Vendure | Vitest is ESM- and TS-native with no transform config, and the same runner covers unit, integration and the §4.2 structural test. Testcontainers gives each integration run a real Postgres, so the SQL under the tenant filters is actually exercised. Mocking Vendure was rejected on evidence: a mock would have cheerfully passed while the real `administrators` query returned every tenant's users (AUTH-PLAN §2.1). |

---

## 2. Runtime topology

```
                      ┌────────────────────────────────────────┐
  merchant / vendor   │  df-store (one container)              │
  browser ───────────▶│                                        │
                      │  Next.js  ── static SPA assets         │
                      │      └───── /api/trpc/*  (BFF)         │
                      │      └───── job runner (in-process)    │
                      └───────┬─────────────────┬──────────────┘
                              │                 │
                   Bearer + vendure-token       │
                   + X-DF-BFF-Proof             │
                              │                 │
                              ▼                 ▼
                   ┌─────────────────┐   ┌──────────────┐
                   │ vendure-backend │   │ BFF Postgres │
                   │  (system of     │   │ (platform    │
                   │   record)       │   │  state only) │
                   └─────────────────┘   └──────────────┘
                              │
                   GitHub App, Stripe Billing, DNS/TLS provider
                   (all called from the BFF, never the browser)
```

One deployable. Next.js serves the SPA and hosts the tRPC handler; the job runner starts in the same process (§8). The browser talks only to `df-store`, never to Vendure — SAAS-PLAN §8 and AUTH-PLAN §4 both depend on that.

Single domain (`app.dripfunnel.com`). Tenancy comes from the session, never from a subdomain or a path segment, which keeps one cookie and removes an entire class of tenant-confusion bug.

---

## 3. Repository layout

```
src/
  app/                    Next.js routes; thin — pages render, they do not decide
  client/                 SPA: components, hooks, the generated tRPC client
  server/
    trpc/
      procedures.ts       ★ the only place base procedures are defined (§4.2)
      routers/            one router per domain: catalog, orders, users, vendors, billing…
    context/
      session.ts          session read/write, cookie handling
      tenant.ts           TenantContext construction — the single source of scope
    vendure/
      client.ts           ✖ raw transport. Importable ONLY by scoped-client.ts
      scoped-client.ts    ★ every Vendure call in the app goes through here (§5)
      privileged.ts       service-account operations, each one audited (§5.3)
      generated/          types generated from the live Admin schema (§5.1)
    db/
      schema.ts           Drizzle table definitions (§6)
      migrations/         generated SQL, committed and reviewed (§10)
    jobs/
      runner.ts           poller; isolated so it can become its own process (§8)
      handlers/           one per job type, each with compensation
    audit/                who really did what (§6.3)
    config.ts             typed env, validated at boot (§9)
```

Two files carry the architecture, marked ★. If a change makes it possible to reach Vendure without going through `scoped-client.ts`, or to declare a procedure without a base from `procedures.ts`, that change is wrong regardless of what it fixes.

---

## 4. Tenancy and scope — the core

AUTH-PLAN §2.6 is the fact everything here answers: **Vendure's permissions are per-channel and never per-row**, so for vendors it enforces nothing at all. Combined with an explicit endpoint API, a single unfiltered endpoint is a cross-vendor catalogue leak. Discipline does not scale to that; structure does.

### 4.1 `TenantContext`

A user may belong to several marketplaces at once (AUTH-PLAN §3), so the session holds a *set* of memberships and each request names the channel it acts in. The context is resolved per request by **looking that channel up in the session's set** — an authorization check against a server-held allowlist, never trust in the request:

```ts
type SellerScope =
  | { kind: 'all' }                          // merchant staff in this channel
  | { kind: 'seller'; sellerId: string };    // vendor in this channel

interface Membership {                       // one row per (user, channel)
  channelId: string;
  channelToken: string;
  permissions: Permission[];
  sellerScope: SellerScope;
}

interface TenantContext {
  adminId: string;
  acting: Membership;                        // resolved from the session set, never from input
  subscription: 'active' | 'trialing' | 'past_due' | 'canceled';
}
```

Two properties do the work:

`SellerScope` is a discriminated union with no default. A caller must say which case it is, so "I forgot to pass the filter" is a type error rather than a silent full-catalogue read, and every `{ kind: 'all' }` is a deliberate, greppable statement.

**Everything scoped hangs off `acting`, never off `adminId`.** The same person can be staff in one marketplace and a vendor in another, so there is no such thing as "this user's sellerId" or "this user's permissions" — only this user's *in this channel*. Resolving either from the user is the single likeliest way to leak one marketplace into another, and the shape above is what makes that unspellable.

### 4.2 Procedure bases

`procedures.ts` is the only module that calls `t.procedure`. Everything else composes:

| Base | Guarantees |
|---|---|
| `publicProcedure` | No session. Login, accept-invite, forgot-password only. |
| `tenantProcedure` | Valid session; **acting channel verified to be in the session's membership set**; `TenantContext` built; subscription gate applied for that channel (SAAS-PLAN §10). |
| `scopedProcedure` | `tenantProcedure` + the `sellerScope` is threaded into the Vendure client — vendor reads are filtered without the router asking. |
| `capabilityProcedure(cap)` | `tenantProcedure` + a portal capability (`invite`, `manage-vendors`, `approve`, `publish`), Owner-only **in the acting channel** — a user may be an Owner in one marketplace and a vendor in another. AUTH-PLAN §9, check 2. |
| `privilegedProcedure(cap)` | `capabilityProcedure` + service-account client + mandatory audit record (§5.3, §6.3). |

Catalog and order routers are built from `scopedProcedure`, so the filter is applied by the base rather than remembered by the author. A lint rule bans `t.procedure` outside `procedures.ts`, and a test enumerates the router tree and asserts every procedure derives from a base — a new endpoint cannot quietly opt out.

### 4.3 Input sanitising is part of the boundary

AUTH-PLAN §8.3–8.4: a vendor holds `UpdateProduct` on the channel, so hiding a control is not a control. Vendor input types **omit** `sellerId`, `enabled` and `approvalStatus` at the type level, and the zod schemas reject unknown keys rather than stripping them silently — a vendor client sending them gets an error, which is a signal worth seeing.

### 4.4 What still cannot be structural

Two things remain the author's responsibility, so they get explicit tests:

- **Fulfilment line ownership** (AUTH-PLAN §8.5) — every `orderLineId` in a vendor's fulfilment must belong to that vendor. The highest-risk write in the system.
- **Order-line filtering** — the partial order view is assembled in the BFF; no base can know which lines belong to whom.

---

## 5. Talking to Vendure

### 5.1 Generated types, checked in CI

Types are generated from the **live** Admin schema, not hand-written. The schema changes whenever a custom field or plugin is added in `vendure-backend`, and SAAS-PLAN §11 adds several. CI regenerates and fails on drift, so a backend change that breaks the portal is caught in a pull request rather than at runtime.

### 5.2 Two clients, two identities — deliberately different types

| Client | Identity | Who enforces |
|---|---|---|
| `UserClient` | The signed-in user's own Vendure token | Vendure, per channel (defence in depth) |
| `PrivilegedClient` | Service account | **The BFF, entirely** (AUTH-PLAN §2.3) |

They are separate types, not one client with a flag, so reaching for the privileged one is a visible decision at every call site. `PrivilegedClient` lives only in `privileged.ts` and every method there writes an audit record (§6.3) — that is the point of confining it.

Both inject `Authorization`, `vendure-token` and the `X-DF-BFF-Proof` HMAC (AUTH-PLAN §8.2) in the transport layer, so no route handler can forget a header.

### 5.3 Transport details that bite

- **Asset upload is GraphQL multipart** (SAAS-PLAN §8, exception 2) — `createAssets` uses the `Upload` scalar, so the client needs multipart support; plain `fetch` with a JSON body will not do.
- **Product export is REST** (exception 1) — a small HTTP client alongside the GraphQL one. It is authenticated, so §5.4's proof header applies there too, or it becomes the bypass.
- **Import has both paths** — core's `importProducts(csvFile: Upload!)` or the plugin's endpoint. Choose per feature; do not assume only REST exists.

### 5.4 The proof secret

AUTH-PLAN §8.2's HMAC secret is what stops a vendor logging in to `/admin-api` directly and reading the merchant's whole catalogue. It is a signing key: injected at deploy, never in the SPA bundle, never in the storefront build, rotatable without a code change. Treat its leak as a platform-wide incident, because it is one.

---

## 6. Data ownership

**Rule: every field has exactly one home.** SAAS-PLAN's "Vendure remains the single system of record" is about commerce data; the BFF owns platform data Vendure has no concept of.

### 6.1 Vendure keeps

Everything commerce — products, orders, customers, channels, roles, administrators — plus the tenant lifecycle fields SAAS-PLAN §10 puts on `Channel` custom fields (`planId`, `subscriptionStatus`, `trialEndsAt`, `customDomain`, `domainStatus`, `templateVersion`) and the deploy fields that already exist. The publish pipeline reads those, so moving them would break it.

### 6.2 The BFF database keeps

| Table | Holds |
|---|---|
| `tenant` | `channel_id`, `channel_token`, and the **cloned role ids** (AUTH-PLAN §5.2 — matching by code is how tenants get cross-wired) |
| `membership` | `(admin_id, channel_id, seller_id)` — which marketplaces a user belongs to, and their vendor identity in each. Vendure cannot hold this: `Administrator` custom fields are one value per user platform-wide (AUTH-PLAN §2.12) |
| `session` | Vendure token, user id, timestamps; memberships resolved from the table above (AUTH-PLAN §4) |
| `job` | Durable work: type, state, attempts, last error, compensation log (§8) |
| `ai_run` | Prompt, tokens in/out, cost, resulting commit, preview URL — SAAS-PLAN §14's second metric |
| `billing_event` | Stripe event ids for idempotency; webhooks arrive more than once |
| `audit_log` | §6.3 |

Denormalised copies are allowed only with an explicit invalidation path. `subscriptionStatus` is cached on the session so the per-request gate costs nothing, and the Stripe webhook invalidates it — that is the pattern; anything else duplicating a Vendure field needs the same justification.

### 6.3 The audit log is not optional

Because the BFF acts as a service account, **Vendure's own event history attributes every privileged action to one account**. Who actually invited a user, approved a product, changed a vendor's access level or published a storefront exists nowhere unless the BFF records it. For a platform hosting other people's businesses that is both an operational need and a support one. Every `privilegedProcedure` writes: real actor, tenant, action, target, before/after where meaningful.

---

## 7. Sessions

Implemented as AUTH-PLAN §4 specifies. Architecturally what matters here:

- Server-side in Postgres, keyed by an opaque `httpOnly` cookie. No Vendure token ever reaches the browser.
- Idle 2h / absolute 12h, independent of Vendure's `sessionDuration` (which AUTH-PLAN §2.11 says to bound anyway).
- **The BFF can revoke instantly; Vendure cannot.** `sessionCacheTTL` delays permission changes by up to five minutes, so lowering a vendor's access level must also delete that user's BFF sessions — otherwise the downgrade appears not to work.

---

## 8. Jobs

Provisioning (SAAS-PLAN §4) is six steps across Vendure, GitHub and a build, with a two-minute target and no transactional "create tenant" call anywhere (SAAS-PLAN §8). Failure midway is normal, not exceptional.

Each job is a row with an explicit state machine and a per-step **compensation** — created a Channel then failed at the repo step, delete the Channel. Handlers are idempotent because retries and duplicate webhooks both happen.

The runner polls the table in-process. It is isolated behind an interface with no Next.js imports so that moving it into its own container later is a deployment change, not a rewrite — which is what SAAS-PLAN §12 will want once AI runs and builds compete with request traffic.

Job types: `provision-tenant`, `provision-vendor`, `publish-storefront`, `ai-edit-run`, `sync-template`, `provision-domain`.

---

## 9. Config and secrets

Typed config module, validated at boot, **process exits on a missing or malformed value.** This is a direct response to a live problem in the sibling repo: `vendure-backend` reads `AWS_ACCESS_KEY_ID` while CI writes `S3_ASSET_ACCESS_KEY_ID`, so credentials silently resolve to `undefined` in production (its CLAUDE.md, "Known discrepancies"). Failing loudly at boot is worth more than any amount of care with names.

Validation is triggered from `src/instrumentation.ts`, not from a route module. Module scope is also evaluated during `next build`, so validating there made the *image build* require production secrets. `register()` runs only when a server instance starts, which keeps the boot-time guarantee without dragging secrets into build time. `/api/health` re-checks per request, and that is what the deploy gate polls.

**Config is passed at container start, not baked into the image** — a deliberate departure from the backend, which does `COPY docker.env ./.env`. Secrets in image layers are readable by anyone who can pull from ECR, and this app reads `process.env` directly rather than loading a bundled `.env` of its own. The values are set as `-e` flags by `deploy-remote.sh`, so **adding a variable means updating both the reusable workflow and that script** — setting it on the host does nothing.

Secrets: Vendure service-account credentials, the §5.4 proof secret, the session cookie secret, Stripe keys, GitHub App private key, DNS/TLS provider token. None reach the SPA bundle; the build must fail if a non-public key is referenced from client code.

---

## 10. Build and deploy

Multi-stage Docker on `node:20-alpine` (Next.js `standalone` output), pushed to ECR, deployed to the host over SSH by the self-hosted runner — mirroring `vendure-backend/.github/workflows/deploy-runner-reusable.yml`, including the health-check-then-rollback behaviour, which is worth copying rather than reinventing.

`main` → prod, `dev` → dev, automatic on push. **Treat any push to those branches as a deploy**, as in the backend repo.

Migrations run as a throwaway `docker run --rm … node dist/migrate.mjs` **before** the running container is replaced. A failed migration therefore aborts the deploy with the previous version still serving, rather than swapping in an app that cannot read its own schema. They must still be backward-compatible for one release, because the old container keeps running against the new schema for the length of that step — and again if a rollback follows.

The migrator is bundled by `npm run build:migrator` rather than shipped as source: `output: 'standalone'` only includes modules traced from the app graph, and `drizzle-orm/node-postgres/migrator` is never imported at runtime, so it would not be in the image.

`/api/health` is the deploy gate and checks the database, not just the process. A container that answered 200 while unable to reach Postgres would let a broken deploy replace a working one.

---

## 11. Observability

SAAS-PLAN §14 says the model's viability rests on two numbers, tracked per tenant per month from the first tenant. They are architecture, not reporting: **build minutes** and **AI tokens/cost** both need a home at the moment the work runs, which is why `ai_run` and `job` are tables rather than logs.

Also: provisioning success rate and time-to-first-store, failed-build rate after AI edits, fleet `templateVersion` drift.

Every log line carries tenant id and, where relevant, seller id. A tenant-scoped support question is otherwise unanswerable.

---

## 12. Testing

**Vitest** everywhere, **Testcontainers** for a real Postgres, **Playwright** for a deliberately small set of journeys. Weighted at the boundary rather than spread evenly:

- **Authorization tests are the priority.** AUTH-PLAN §9 lists nine checks; points 5–8 have no equivalent anywhere else in the stack. Drive them through tRPC's `createCaller(ctx)` rather than over HTTP — a context is just an object, so the full matrix of *(user kind × acting channel × endpoint)* is cheap to enumerate and fast to run. Assert that a vendor cannot read or write outside its `sellerId`, that `enabled` / `approvalStatus` / `sellerId` are rejected in vendor input, and that a user who is staff in A and a vendor in B leaks neither into the other (AUTH-PLAN §9).
- **The structural test**: walk the tRPC router tree and assert every procedure derives from a base in `procedures.ts` (§4.2). Plain Vitest, no fixtures. This catches the one mistake the type system cannot.
- **Integration tests against a real Postgres** via Testcontainers. The tenant filters are SQL; an in-memory fake would prove nothing about them.
- **Contract tests against a real Vendure**, reusing the backend repo's docker-compose rather than a mock. The schema is the risk, and it changes from another repo (§5.1).
- **Provisioning rollback**: inject a failure at each step and assert no partial tenant survives (§8).
- **Playwright, sparingly** — login, marketplace switch, accept-invite. Enough to prove the session and cookie wiring works end to end; the authorization matrix stays at the API layer where it runs in milliseconds instead of minutes.

---

## 13. Risks

| Risk | Detail |
|---|---|
| **A forgotten filter is a cross-tenant leak** | The cost of the explicit-endpoint API. §4.2's bases and §12's structural test are the mitigation; neither is free, and both must be maintained. |
| **The proof secret is one key for the whole platform** | It protects every merchant's catalogue from every vendor (AUTH-PLAN §8.2). Rotation must be practised before it is needed. |
| **Vendure schema drift** | Custom fields and plugins change the schema from another repo. §5.1's CI check is what makes that a build failure instead of a production one. |
| **The BFF holds a service account with full reach** | Compromise is platform-wide. Confining it to `privileged.ts` with mandatory audit is containment, not prevention. |
| **`sessionCacheTTL` (5 min)** | Permission changes are not immediate anywhere the BFF is not the enforcer. |
| **A multi-marketplace user is a bridge between tenants** | One session and one Vendure token valid in several marketplaces. Checks 1, 2 and 5 of AUTH-PLAN §9 are the only thing keeping them apart, and the failure mode is silent. |
| **Single deployable** | Job runner and request traffic share a process until §8's extraction. Fine early; a known limit. |

---

## 14. Open questions

- **Preview deploys.** The chosen deploy path does not give them for free. Do PRs get an environment, or is `dev` the shared preview?
- **Where does the AI agent actually execute?** SAAS-PLAN §7 needs a sandbox with a build toolchain. In the job runner's container, a separate build host, or GitHub Actions? This decides whether §8's worker extraction is optional or mandatory.
- **Same Postgres server as Vendure, or its own from day one?** The decision is a separate *database*; the server is still open, and it is a cost-versus-blast-radius call.
- **Does the portal need an external API?** If partner or mobile clients are coming, tRPC alone will not serve them and a REST facade should be planned rather than retrofitted.
- **Rate limiting and abuse controls** (AUTH-PLAN §9) — in the app, or at a reverse proxy in front of it?
