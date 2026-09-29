# FEATURE-ENVIRONMENTS.md: a complete environment per feature branch

Every branch whose name contains `feature` gets its own separate copy of the platform:

- its own API Worker,
- its own merchant portal, partner console and admin console,
- its own database, branched on Neon,
- its own hostnames on `dripfunnel.ai`.

It is deployed on every push and deleted when the branch goes. The workflow is
[`.github/workflows/feature-env.yml`](../../.github/workflows/feature-env.yml). The tooling is in
[`apps/api/scripts/feature-env/`](../../apps/api/scripts/feature-env/).

Last updated: 2026-09-29.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **An environment only for branches containing `feature`** (lowercase, anywhere in the name). Other branches and pull requests run the gates only | A preview for every pull request (the earlier ARCHITECTURE §6 plan) | Fewer environments and lower cost. Name a branch `feature/…` to get one |
| **A separate Cloudflare account ("DripFunnel Dev") holds every feature environment**, with the `dripfunnel.ai` zone | The production account | Cloudflare tokens can't be narrowed to certain Workers or projects. On the production account, code from any feature branch would run with a token that can change production. A separate account also gives feature environments their own 25 Hyperdrive slots |
| **A separate Neon project (`dripfunnel-dev`)**; each environment is a branch of its default branch, which holds seeded dummy data | Branching production; an empty database each time | No real personal data ever reaches a feature environment. A key scoped to that project can't reach production |
| **Same shape as production**: three Cloudflare Pages projects for the SPAs, and one Worker serving `/api/*` on each SPA's hostname plus the hooks host | One Worker serving the SPAs as static assets | Feature environments exercise the production setup. This includes the unverified "Worker route on a Pages custom hostname" check in [../ARCHITECTURE.md](../ARCHITECTURE.md) §2, which the first deploy answers |
| **Flat hostnames on a dev domain**: `<slug>-store.dripfunnel.ai` and so on | Nested names (`admin.<slug>.dev…`); the production domain | Cloudflare's free certificate covers one level below the zone. Test cookies, email and search engines stay off the production domain |
| **Cloudflare Access** in front of every feature hostname, for anyone `@softobotics.com` | Open links | Unfinished work and test data stay private |
| **Deleted when the branch is deleted, and after 14 days without a commit** | Deleting manually only | Forgotten branches don't use up Neon branches, Hyperdrive slots and Pages domains. Pushing again recreates the environment from the seed |
| **Outside services use shared test accounts** (Stripe test mode, the SES sandbox, Razorpay test, a separate `dripfunnel-dev` GitHub org for storefront repos). Each environment tags what it creates with its slug | Fakes in feature environments | Real integration problems show up before staging. Applies as each integration is built; none exists yet |

---

## 2. What one environment is

For branch `feature/offers` (slug `offers`):

| Part | Name | Notes |
|---|---|---|
| Merchant portal | `https://offers-store.dripfunnel.ai` | Pages project `dripfunnel-feature-store`, branch deploy `offers` |
| Partner console | `https://offers-platform.dripfunnel.ai` | Pages project `dripfunnel-feature-platform` |
| Admin console | `https://offers-admin.dripfunnel.ai` | Pages project `dripfunnel-feature-admin` |
| API | `/api/*` on the three hosts above; all of `offers-hooks.dripfunnel.ai` | Worker `dripfunnel-feature-offers`. Its `ADMIN_HOST`, `PLATFORM_HOST` and `HOOKS_HOST` point at the feature hosts, so the router behaves as in production |
| Database | Neon branch `feature/offers` in `dripfunnel-dev` | Copied from the seeded default branch; the branch's own migrations are applied on each deploy |
| Pooling | Hyperdrive config `feature-offers`, bound as `HYPERDRIVE` | Uses Neon's direct connection string, as Cloudflare advises for Hyperdrive. Production adds the same binding name when the API gets its database (PLATFORM-PROMPT §8 slice 3) |

**Slug rules** (`names.ts`, tested):

- a leading `feature/`, `feature-` or `feature_` is dropped;
- the rest is lowercased, and anything else than `a-z0-9` becomes `-`;
- the slug is at most 20 characters, so it fits Pages' 28-character branch alias and
  DNS labels; longer names are cut and given a 4-character hash of the full branch name.

Branches that give the same slug (`feature/offers` and `feature-offers`) share one
environment, so avoid that.

Queues, R2 buckets, KV and secrets are added to the environment the same way as the API
gains them. Each gets its own `<slug>`-named resource, created in `prepare` and removed in
`destroy`.

---

## 3. Lifecycle

| Event | Job | What happens |
|---|---|---|
| Push to a feature branch, or manual "deploy" | `deploy` | Gates → Neon branch (created once) → Pages projects and Hyperdrive config (created or updated) → migrations (`migrate`, once it exists) → the three SPA builds deployed to Pages branch `<slug>` → custom domains and proxied CNAMEs to `<slug>.<project>.pages.dev` → Worker deployed from a generated `wrangler.feature.json` → URLs in the run summary |
| Branch deleted | `destroy` | Removes, in this order: Worker routes and custom domain, Worker, Pages domains, DNS records, Pages branch deployments, Hyperdrive config, Neon branch. Every step tolerates "already gone". A partial failure fails the job and names what's left |
| Nightly (03:17 UTC) | `prune` | Finds every environment (Workers, Hyperdrive configs and Neon branches with the feature prefixes). Destroys those whose branch no longer exists or has had no commit for 14 days. This also catches missed delete events and half-created environments |
| Manual "destroy" | `destroy` | For the branch the workflow is run on |

The `destroy` path never touches a name without the feature prefix. It refuses to delete a
Neon default branch.

**GitHub runs `delete` and `schedule` events from the workflow on `main`**, so automatic
removal starts only once this workflow is merged to `main`.

---

## 4. One-time setup

1. **Cloudflare dev account.**
   1. Create a Cloudflare account "DripFunnel Dev" on Workers Paid.
   2. Add the `dripfunnel.ai` zone to it. If the zone is in another account now, remove it
      there first; Cloudflare may assign new nameservers, so update them at the registrar.
   3. Set SSL to Full (strict).
2. **Cloudflare API token** (dev account only). Give it these permissions:
   - *Account*: Workers Scripts Edit, Cloudflare Pages Edit, Hyperdrive Edit;
   - *Zone `dripfunnel.ai`*: Zone Read, DNS Edit, Workers Routes Edit.

   Add more permissions as resources are added (Queues Edit, Workers R2 Storage Edit,
   Workers KV Storage Edit).
3. **Cloudflare Access** (Zero Trust on the dev account; login method: one-time PIN):
   1. Self-hosted application **`*.dripfunnel.ai`**, with an **Allow** policy for emails
      ending in `@softobotics.com`.
   2. Self-hosted application **`*-hooks.dripfunnel.ai`**, with a **Bypass** policy for
      everyone, so providers' test webhooks get through. The webhooks verify their own
      signatures.
   3. After the first deploy, turn on **Access for preview deployments** in each of the three
      `dripfunnel-feature-*` Pages projects. Otherwise the `*.pages.dev` branch aliases stay
      public.
4. **Neon.**
   1. Create a project `dripfunnel-dev`.
   2. Its default branch holds the seeded dummy data (partners, stores and products for US,
      DE and IN, as in the prototypes). The seed script comes with the database, in slice 3.
   3. Create a **project-scoped** API key.
5. **GitHub environment `feature`** in `dripfunnel/platform`:
   - Deployment branches: `main` (for delete and nightly runs) and the patterns `*feature*`
     and `**/*feature*`.
   - Secrets: `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`.
   - Variables: `CLOUDFLARE_ACCOUNT_ID` (dev account), `FEATURE_ZONE_ID` (`dripfunnel.ai`),
     `FEATURE_DOMAIN` = `dripfunnel.ai`, `NEON_PROJECT_ID` (`dripfunnel-dev`).
6. Merge the workflow to `main`, then push a `feature/…` branch.

---

## 5. Limits

These were checked against Cloudflare's documentation on 2026-09-29. Re-check them before
relying on them.

| Limit | Value | Effect |
|---|---|---|
| Hyperdrive configs per account (Paid) | 25 | **At most about 25 feature environments at once** in the dev account. The 26th deploy fails at "Pages projects, Hyperdrive, Worker config" until one is removed |
| Custom domains per Pages project | 100 on Free, 250 on Pro | One domain per environment in each project |
| Pages branch alias length | 28 characters | The slug is at most 20 |
| Pages projects per account | 100 | Three are used, shared by every environment |
| Neon branches per project | Depends on the plan | One per environment, plus the default branch |

---

## 6. To verify on the first run

These follow Cloudflare's documented behaviour, but no deploy has run yet:

- **Custom domain on a branch alias through the API.** The documentation describes adding
  the domain to the project and pointing its proxied CNAME at `<branch>.<project>.pages.dev`.
  `attach` does the same through the API.
- **A Worker route for `/api/*` on a Pages custom hostname.** This is ARCHITECTURE §2's
  open routing check. If it fails, production needs the Workers static assets fallback too.
- **Access precedence**: the `*-hooks` Bypass application should win over `*.dripfunnel.ai`
  as the more specific match.
- **Deleting a Pages deployment that has an alias** with `?force=true`.
- **The token's permission list** in §4 step 2 is enough for Worker custom domains and route
  deletion.

---

## 7. Open questions

- Should staging live in the dev account too? It would take Hyperdrive slots from feature
  environments.
- Cost ceiling: is about 25 concurrent environments enough, or should the idle limit be
  shorter than 14 days?
