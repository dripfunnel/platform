# Production setup

Production on `dripfunnel.com`: how to set it up once, how values get onto it, and how a
release goes live. **Production is not fully provisioned yet.** §2 says what is missing, and
each step below that hasn't been done is marked **Not done yet**.

Last updated: 2026-10-04.

The deploy design is decided in [ARCHITECTURE.md §6](../ARCHITECTURE.md). What each value is
for, its least scope and how to make it is in
[THIRD-PARTY-ACCESS.md §2 and §8](../code/THIRD-PARTY-ACCESS.md). Promoting and rolling back are
in [ROLLBACK.md](../code/ROLLBACK.md).

**A push to `main` is a production action.** It runs migrations against the production database
and uploads a new Worker version. `main` isn't protected yet, so a direct push deploys with no
pull request.

---

## 1. What production is

| Part | Production |
|---|---|
| Cloudflare account | the production account (Workers Paid), separate from the dev account |
| Zone | `dripfunnel.com` |
| API Worker | `dripfunnel-api` (`wrangler.jsonc` › `env.prod`) |
| Hosts | `admin.dripfunnel.com`, `platform.dripfunnel.com`, `hooks.dripfunnel.com`; merchant portals on each partner's own host, e.g. `store.<partnerdomain>` (custom hostnames, SAAS.md §8) |
| Consoles | Pages projects `dripfunnel-admin`, `dripfunnel-platform`, `dripfunnel-store` |
| Database | Neon production project or branch *(decide, THIRD-PARTY-ACCESS.md §2.2)*, Postgres **18**, through Hyperdrive |
| Gate | Cloudflare Access on `admin.dripfunnel.com` (recommended, §2.1) |
| Deploys | `prod.yml` on every push to `main` (gates, migrations, Worker **upload**); `promote.yml` by hand (Worker to 100%, health check, consoles) |
| Third parties | Live mode: Stripe live keys, SES production access, the Entra registration's production redirect |

---

## 2. What is missing today

| Missing | Effect | Step |
|---|---|---|
| No Hyperdrive binding in `env.prod` (#51) | The Worker has no database: `/api/health` reports `db: "unconfigured"` | §3.4 |
| No routes in `env.prod` | `admin.`, `platform.` and `hooks.dripfunnel.com` don't reach the Worker, so `promote.yml`'s health check on `platform.dripfunnel.com/api/health` can't pass | §3.5 |
| No R2 bucket or binding | Uploads fail | §3.4 |
| `main` unprotected | A direct push deploys without review; `prod.yml` runs its own gates in the meantime | §3.7 |
| The first super admin | Nobody can sign in to an empty production database (dev.md §5) | §6 |

---

## 3. One-time setup

Done once, by whoever holds the production Cloudflare, Neon, GitHub, Microsoft, Stripe and AWS
admin rights. Take each value straight from its source into its place. Never through chat,
email or a file in the repo.

### 3.1 Cloudflare account and zone

1. Production Cloudflare account on **Workers Paid**.
2. The `dripfunnel.com` zone in it; SSL **Full (strict)**.
3. Note the **account id** and the **zone id** (dashboard › the zone › overview).

### 3.2 Deploy token

1. Cloudflare › My Profile › API Tokens › *Create token* › custom token, on the **production
   account only**.
2. Permissions: Workers Scripts Edit, Cloudflare Pages Edit, Workers Routes Edit on
   `dripfunnel.com`, and Queues, Workflows and Hyperdrive Edit (THIRD-PARTY-ACCESS.md §2.1).
3. Copy it once into the GitHub `prod` environment (§3.6).

### 3.3 Neon

1. Production database on Postgres **18**. Whether it's its own project or a branch is still
   to decide (§7).
2. Roles:
   - **migration role**: owns the schema, with `CREATEROLE` and `BYPASSRLS`
     ([api/README.md §7](../api/README.md)); used only by `prod.yml`;
   - **app role**: what the Worker uses, **without** `BYPASSRLS` (DATA-MODEL.md §5.3).
3. A separate, **disposable** branch for `prod.yml`'s gates. Never the production branch.
4. Note:
   - the migration role's **direct** string → `PROD_DATABASE_URL`;
   - the test branch's string → `TEST_DATABASE_URL` (prod's own, not dev's);
   - the app role's **pooled** string → Hyperdrive (§3.4);
   - the two hostnames → `ALLOWED_MIGRATION_HOST` and `ALLOWED_TEST_HOST`.

### 3.4 Hyperdrive and R2 — **Not done yet**

1. Create Hyperdrive on the production account:
   ```bash
   wrangler hyperdrive create dripfunnel-prod --connection-string="<app role pooled string>"
   ```
2. Add `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }]` to `env.prod` in
   `wrangler.jsonc`, in a pull request (#51).
3. Set `HYPERDRIVE_REQUIRED=1` on the Worker (§4) in the same release, so a lost binding turns
   `/api/health` red.
4. `wrangler r2 bucket create dripfunnel-assets`, then add the `ASSETS` binding to `env.prod`.
   Create the bucket first: a binding to a missing bucket fails the deploy.

### 3.5 Routes and console hostnames — **Not done yet**

1. Add routes to `env.prod`, following `env.dev`'s pattern:
   `admin.dripfunnel.com/api/*`, `platform.dripfunnel.com/api/*` on the zone, and
   `hooks.dripfunnel.com` as a custom domain. *(decide in the card that adds them; the store
   API's hosts come with custom hostnames, SAAS.md §8)*
2. After the first `promote.yml` creates the Pages projects, attach `admin.dripfunnel.com` to
   `dripfunnel-admin` and `platform.dripfunnel.com` to `dripfunnel-platform` (Pages › the
   project › Custom domains).
3. Put Cloudflare Access in front of `admin.dripfunnel.com`, connected to the staff identity
   provider (THIRD-PARTY-ACCESS.md §2.1).

### 3.6 GitHub environment `prod`

Repository › Settings › Environments › *New environment* › `prod`:

1. **Deployment branches:** `main` only.
2. **Required reviewers:** recommended, so `promote.yml` waits for a second person.
3. **Secrets:**

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from §3.2 |
   | `PROD_DATABASE_URL` | the migration role's direct string |
   | `TEST_DATABASE_URL` | prod's disposable test branch |

4. **Variables:**

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | the production account id |
   | `ALLOWED_MIGRATION_HOST` | the hostname in `PROD_DATABASE_URL` |
   | `ALLOWED_TEST_HOST` | the hostname in prod's `TEST_DATABASE_URL`; must differ from the one above |

### 3.7 Protect `main`

When the `dripfunnel` org moves to GitHub Team: apply the `protect-main` ruleset (pull requests
only, the CI `gates` check required, no force-push or deletion), then remove the `gates` job
from `prod.yml` (ARCHITECTURE.md §6).

---

## 4. The Worker's values

Cloudflare dashboard (production account) › Workers & Pages › **`dripfunnel-api`** › Settings ›
**Variables and Secrets** › *Add*, or `wrangler secret put <NAME> --env prod` from `apps/api`.
A deploy keeps them (`keep_vars`). Saving one deploys it at once, so production changes the
moment you save.

**Every secret is production's own.** Never one from dev or a laptop.

| Name | Type | Production value | How to get it |
|---|---|---|---|
| `ADMIN_HOST` | Text | `admin.dripfunnel.com` | fixed |
| `PLATFORM_HOST` | Text | `platform.dripfunnel.com` | fixed |
| `HOOKS_HOST` | Text | `hooks.dripfunnel.com` | fixed |
| `HYPERDRIVE_REQUIRED` | Text | `1` | only once the binding exists (§3.4) |
| `CREDENTIALS_KEK` | Secret | a new key | `openssl rand -base64 32`. Store it in the password manager **before** saving it. Losing it makes every encrypted 2-factor secret and partner or merchant credential unreadable for good; it carries a version for rotation (THIRD-PARTY-ACCESS.md §5) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Secret | the staff registration | Entra admin center (THIRD-PARTY-ACCESS.md §2.5). Redirect URI `https://admin.dripfunnel.com/api/auth/callback`. The client secret expires (24 months at most): note the date |
| `STRIPE_SECRET_KEY` | Secret | **live** restricted key `rk_live_…` | Stripe (live mode) › Developers › API keys › *Create restricted key*, with only the permissions in THIRD-PARTY-ACCESS.md §8 |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_…` | Stripe (live mode) › Webhooks › *Add endpoint* `https://hooks.dripfunnel.com/stripe`, events as in §8, *Listen to events on Connected accounts* From SAPI 10, the same endpoint also receives connected merchant accounts' events (THIRD-PARTY-ACCESS §3.1, proposed) |
| `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | Secret | the sending IAM user | THIRD-PARTY-ACCESS.md §2.4. Ask for SES **production access** early; approval takes days |
| `SES_SENDER_DOMAIN` | Text | `dripfunnel-mail.com` | verified in SES with DKIM, SPF and DMARC; partners' fallbacks are its subdomains |
| `EMAIL_SUPPRESSION_KEY` | Secret | a new key | `openssl rand -base64 32`; keys the suppression list's hashes. Email doesn't send without it |
| `SES_EVENTS_TOPIC_ARN` | Secret | the production bounce topic's ARN | SNS topic with `SignatureVersion` 2, subscribed to `https://hooks.dripfunnel.com/ses` |

The consoles' build flags in production: `VITE_STATE_HARNESS` stays **unset** (no `?state=`
harness in production). `VITE_ADMIN_URL` defaults to `https://admin.dripfunnel.com`.

---

## 5. Releasing

1. Merge a pull request into `main`.
2. **prod.yml** runs: gates against the test branch → migrations against production →
   uploads a new Worker version. **Nothing is live yet.**
3. Open the run's summary. It gives the **version id** and the **commit sha**.
4. Run **promote** (Actions › promote › *Run workflow*) with that `version_id` and
   `commit_sha`, soon after, and only for the most recent upload. It:
   1. checks that the version was built from that commit;
   2. moves the Worker to 100%;
   3. checks `https://platform.dripfunnel.com/api/health` reports that version;
   4. only then builds and deploys the three consoles from the same commit.
5. If the health check fails, or something is wrong after release, follow
   [ROLLBACK.md](../code/ROLLBACK.md).

Migrations run at step 2, before the new version is live, so every migration must work with the
version still running (AGENTS.md "Data").

---

## 6. Checklist

- [ ] Account, zone, SSL Full (strict) (§3.1)
- [ ] Deploy token (§3.2)
- [ ] Neon production database, roles, disposable test branch (§3.3)
- [ ] Hyperdrive and R2, in `env.prod` (§3.4)
- [ ] Routes, console hostnames, Access on admin (§3.5)
- [ ] GitHub environment `prod`, with required reviewers (§3.6)
- [ ] `main` protected (§3.7)
- [ ] Every Worker value in §4, with the KEK in the password manager
- [ ] SES production access granted
- [ ] The first super admin can sign in (§7)
- [ ] A first release promoted, with `/api/health` reporting `db: "ok"` (§5)

---

## 7. Open questions

1. Production database: its own Neon project, or a branch (THIRD-PARTY-ACCESS.md §2.2). *(decide)*
2. Production routes in `env.prod`, and how the store API's hosts reach the Worker (§3.5). *(decide)*
3. How the first super admin is created on an empty production database. *(decide)*
