# BUILD-PROMPT.md

The prompt to give Claude Code when building this platform. Paste the section below,
or point Claude Code at this file: *"Read BUILD-PROMPT.md and begin."*

---

## Mission

You are building the DripFunnel SaaS platform across two repos:

- [`SoftoboticsTechnologies/vendure-backend`](https://github.com/SoftoboticsTechnologies/vendure-backend)
  — Vendure 3.7.2, the system of record. Exists and runs. Checked out at `~/projects/df/vendure-backend`.
- [`SoftoboticsTechnologies/df-store`](https://github.com/SoftoboticsTechnologies/df-store)
  — the merchant portal and its BFF. Checked out at `~/projects/df/df-store`.

The design is already decided and written down. Your job is to implement it slice by slice,
prove each slice works against a running system, and stop to ask when the spec is silent.

## Read these first, in this order

In `df-store`: `SAAS-PLAN.md` (what the platform becomes), `ARCHITECTURE.md` (how this repo is
built), `AUTH-PLAN.md` (auth, roles, invites, vendors — the deepest spec, read it twice).

In `vendure-backend`: `CLAUDE.md` (constraints that silently break things), `ARCHITECTURE.md`
(current system), `AGENTS.md` (conventions).

**These documents are the specification.** Where they decide something, follow it — the
alternatives were considered and rejected for reasons recorded in the docs. Where they are
silent, use judgement. Where they are *wrong*, fix the document in the same change and say so
in your summary.

## Facts that will bite you

Every one of these was verified against the running Admin API or Vendure's source. They are
counter-intuitive, and code written without them looks correct and leaks data.

1. **`AdministratorService.findAll()` has no channel filter.** Anyone with `ReadAdministrator`
   lists every administrator on the platform. `RoleService.findAll()` beside it *does* filter.
   This is why `channelAdministrators` must exist.
2. **Vendure permissions are per-channel, never per-row.** `ReadProduct` means "all products in
   this channel". With vendors sharing a merchant's channel, Vendure enforces *nothing* between
   them — the BFF is the entire boundary.
3. **Relation and struct custom fields cannot be filtered.** Vendure builds filter params from
   `customEntityFields.filter(f => f.type !== 'relation' && f.type !== 'struct')`. `sellerId`
   and `approvalStatus` must be **scalar** fields or every list query degrades to fetch-all.
4. **`CreateAdministratorInput.password` is non-null.** There is no passwordless invite. See
   AUTH-PLAN §7.2 for the throwaway-password approach.
5. **Vendure's privilege guards key off `ctx.activeUserId`.** Behind a service account they all
   pass. Delegating to a service account discards the protection — the BFF re-implements it.
6. **`Administrator` custom fields are one global value per person.** No per-channel variant.
   This is why membership lives in the BFF database.
7. **`Role.code` has no unique constraint.** Namespace cloned roles; the DB will not catch it.
8. **`assignToCurrentChannel()` assigns to the acting channel *and* the default channel.** The
   default channel therefore sees every tenant's data — which is what makes SAAS-PLAN §11.1 a
   fleet-wide bug and why role templates must not live there.
9. **Session defaults:** `sessionDuration` 1y, `sessionCacheTTL` 300s (permission changes take
   up to 5 minutes to apply), `verificationTokenDuration` 7d (also governs reset tokens).
10. **`SplitOrderContents` is keyed by `channelId`** — no per-seller orders without per-vendor
    channels, which this design does not have.

**Verify rather than trust.** Introspect the live Admin API before writing any query or
mutation — `POST http://localhost:3000/admin-api` answers introspection unauthenticated. That
is the same schema GraphiQL's Docs pane shows. Do not write a query against a remembered
schema; the custom fields change from the other repo.

## Ground rules

- **Do not commit, branch or push unless I ask you to, in that message.** Finish the work, leave
  it in the working tree, and tell me what is ready to go in a commit. "Keep building" and "don't
  stop" mean keep writing and verifying code — they are not permission to commit. What belongs in
  a commit, and what the history says, is my call.
- **Pushing `vendure-backend` to `main` or `dev` deploys it.** Treat any push to those branches
  as a production deploy. When I do ask you to commit, branch rather than commit to a default
  branch, and never push `main` or `dev` without me saying so explicitly.
- **No test suite exists in `vendure-backend`.** You are adding the first ones. Its CLAUDE.md
  says it plainly: *do not claim a change is verified because it compiles.*
- **`node_modules` is patched via patch-package.** If you edit anything there, run
  `npx patch-package <pkg>` so the change is captured in `patches/`, or it vanishes on the next
  install. Leave the patch file in the working tree like any other change.
- **Never weaken a test to make it pass.** Do not delete, skip, or loosen an assertion to get
  green. If a gate cannot pass, stop and report why.
- **Ask, don't guess, on these:** anything listed under "Open questions" in AUTH-PLAN §11 or
  ARCHITECTURE §14. Those are product decisions, not implementation details.

### Known current state

All three below are **fixed on `fix/shipping-method-channel-scoping`, which is not merged**. They
are still present on `main`, so which you hit depends on the branch you are standing on.

- `@tanstack/react-router` floats to 1.170.x, which never fires the router's initial load in dev,
  so the dashboard renders a blank page. The branch pins it to `1.166.2` via `overrides`. Note a
  branch switch does not reinstall — `node_modules` may hold the working version until the next
  `npm install` restores the broken one.
- `npx patch-package --check` fails on `main`: the TanStack route generator rewrites
  `node_modules/@vendure/dashboard/src/app/routeTree.gen.ts`, so the branding patch no longer
  applies and the Vendure branding returns. The branch drops that hunk — it was fighting a code
  generator for no behavioural gain.
- The `AddDeploymentTracker1789036946471` migration fails on every boot on `main` —
  `synchronize: true` already created the table. The server starts anyway, which is why nobody
  noticed. The branch makes it idempotent.

Local development should use `.env.local` and `npm run serve:local` against a local Postgres, not
the shared `dbpg01` dev database — `synchronize: true` means schema changes there hit everyone.

## Build order

Work one slice at a time. **Do not start a slice until the previous one meets its gates**, and
stop at the diff — see the commit rule above.

1. **Backend blockers** — SAAS-PLAN §11.1 (shipping-method exclusivity escaping its channel)
   and §11.2 (`shippingChargeConfig` → channel-scoped). Set up a second Channel locally first;
   it is the harness every later slice needs. Add the repo's first tests here.
2. **Backend hygiene** — the three items under "Known current state", plus AUTH-PLAN §6.4
   (register `adminPasswordChangedHandler` or delete it, audience-aware reset URLs, bounded
   `sessionDuration`).
3. **Backend plugins** — custom fields (AUTH-PLAN §3.3), `AdminInvitePlugin` with
   `channelAdministrators` first (§6.1–6.2), then `BffGuardPlugin` (§8.2).
4. **`df-store` scaffold** — Next.js, tRPC, Drizzle, typed config that exits at boot on a bad
   value, Dockerfile and CI mirroring the backend's deploy workflow.
5. **Session + scope** — ARCHITECTURE §4: `TenantContext`, `SellerScope`, the procedure bases
   in `procedures.ts`, and the structural test that walks the router tree.
6. **Authorization module** — AUTH-PLAN §9, all nine checks, with the test matrix below. Build
   this *before* any endpoint that needs it.
7. **Role templates + provisioning** — AUTH-PLAN §5, the `__role-templates` channel, cloning,
   the membership table.
8. **Invites and auth screens** — AUTH-PLAN §7, including the join path for an existing account.
9. **Vendors** — AUTH-PLAN §8: seller CRUD, `sellerId` filtering everywhere, approval setting,
   input sanitising.
10. **Jobs** — ARCHITECTURE §8: durable table, per-step compensation, provisioning rollback.
11. **Vendor orders** — AUTH-PLAN §8.5, the BFF-constructed partial view.

## The loop

For each slice, repeat until all gates pass:

1. Re-read the relevant spec section. Introspect the live schema for anything you will call.
2. Implement the smallest coherent piece.
3. Write tests **with** it, not after.
4. Run the gates. Read the failures properly — do not pattern-match a fix.
5. Fix and re-run. When a fix contradicts the spec, stop and say so.

### Gates — every one must pass before a slice is done

- `npx tsc --noEmit` clean in both repos.
- Vitest green: unit, integration (real Postgres via Testcontainers), and contract tests
  against a **real** Vendure from the backend's docker-compose. Not mocks — a mocked Vendure
  would have passed while the real `administrators` query returned every tenant's users.
- **The authorization matrix passes.** Drive it through tRPC's `createCaller(ctx)`: for every
  endpoint × user kind (merchant Owner / Manager / Staff / vendor) × acting channel, assert
  that a vendor cannot read or write outside its `sellerId`, that `enabled` / `approvalStatus`
  / `sellerId` are rejected in vendor input, and that a user who is staff in marketplace A and
  a vendor in B leaks neither into the other.
- **The structural test passes**: no tRPC procedure exists that does not derive from a base in
  `procedures.ts`.
- **The app actually runs.** Start it, exercise the new behaviour for real — curl the endpoint,
  or click the screen. Compiling and passing tests is not the same as working.
- Nothing regressed: the full suite, not just the new tests.

## Reporting

After each slice, stop and tell me in plain terms:

- What now works, and **how you proved it** — the command you ran and what it returned.
- What you changed in the spec documents, and why.
- What you deliberately did not do.
- Anything you found that contradicts the docs. This has happened before: SAAS-PLAN §11
  originally blamed an unscoped `findAll()` when the real cause was the default-channel
  RequestContext, and the wrong diagnosis would have produced a wrong fix.

If a gate will not pass, stop and report it. Do not weaken the gate, and do not move on.
A half-finished slice reported honestly is worth more than a green one that is not true.
