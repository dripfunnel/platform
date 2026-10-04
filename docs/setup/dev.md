# Dev environment setup

The shared, long-lived environment on `dripfunnel.ai` that every push to the `dev` branch
redeploys. How to set it up once, how values get onto it, and how to deploy and check it.

Last updated: 2026-10-04.

Why dev looks the way it does is decided in [ARCHITECTURE.md §6](../ARCHITECTURE.md). What
each value is for and how to make it is in [THIRD-PARTY-ACCESS.md §8](../code/THIRD-PARTY-ACCESS.md).
Feature environments (one per `feature` branch) are a separate setup:
[FEATURE-ENVIRONMENTS.md](../code/FEATURE-ENVIRONMENTS.md).

---

## 1. What dev is

| Part | Dev |
|---|---|
| Cloudflare account | "DripFunnel Dev", the same account as feature environments |
| Zone | `dripfunnel.ai` |
| API Worker | `dripfunnel-api-dev` (`wrangler.jsonc` › `env.dev`) |
| Hosts | `dev-admin.dripfunnel.ai`, `dev-platform.dripfunnel.ai`, `dev-store.dripfunnel.ai` (each `/api/*` routes to the Worker), `dev-hooks.dripfunnel.ai` (the Worker's own custom domain) |
| Consoles | Pages projects `dripfunnel-admin-dev`, `dripfunnel-platform-dev`, `dripfunnel-store-dev` |
| Database | Neon project `dripfunnel-dev`, its persistent `dev` branch, through Hyperdrive |
| Gate | Cloudflare Access: `*.dripfunnel.ai` allows `@softobotics.com`; `*-hooks.dripfunnel.ai` is bypassed so providers' test webhooks arrive |
| Deploys | `.github/workflows/dev.yml`, on every push to `dev`, or by hand |
| Third parties | Test mode everywhere: Stripe test keys, the SES sandbox or a test identity, the Entra registration's dev redirect |

What one run of `dev.yml` does, in order:

1. **What changed:** works out which of the API and the three consoles changed since the last
   successful run.
2. **Guard rails:** stops unless `ALLOWED_TEST_HOST` and `ALLOWED_MIGRATION_HOST` are both set,
   and different.
3. **Gates:** `build typecheck lint test`, against the disposable **test** branch
   (`TEST_DATABASE_URL`), never the dev database.
4. **Migrations:** against the persistent dev branch (`DEV_DATABASE_URL`), over Neon's direct
   connection.
5. **Consoles:** deploys each console that changed to its Pages project. A missing project is
   created on the first deploy.
6. **API Worker:** `wrangler deploy --env dev`, if the API changed.

---

## 2. One-time setup

Done once, by whoever holds the Cloudflare, Neon and GitHub admin rights. Each step can be
checked off.

### 2.1 Cloudflare account, zone and Access

1. Create the dev account, add `dripfunnel.ai`, set SSL to Full (strict), and create the two
   Access applications: [FEATURE-ENVIRONMENTS.md §4](../code/FEATURE-ENVIRONMENTS.md) steps 1
   and 3. Dev and feature environments share all of this.
2. Check that the Access applications cover `dev-admin`, `dev-platform` and `dev-store`, and
   that `dev-hooks` falls under the hooks Bypass. Dashboard state that doesn't match yet is
   tracked on #106.

### 2.2 Cloudflare API token for deploys

1. Cloudflare › My Profile › API Tokens › *Create token* › custom token, on the **dev account
   only**.
2. Permissions: *Account*: Workers Scripts Edit, Cloudflare Pages Edit, Hyperdrive Edit (add
   Workers R2 Storage Edit and Queues Edit when those resources arrive); *Zone
   `dripfunnel.ai`*: Zone Read, DNS Edit, Workers Routes Edit.
3. Copy it once. It goes into the GitHub `dev` environment (§2.5).

### 2.3 Neon

1. In the project `dripfunnel-dev` (Postgres **18**), create a branch named `dev`. It is the
   persistent dev database.
2. Create a second branch for CI tests, e.g. `ci-test`. It is disposable: the gates migrate
   and write to it freely.
3. Roles on the `dev` branch:
   - **migration role** (e.g. `migrator`): owns the schema and runs migrations. It needs
     `CREATEROLE` and `BYPASSRLS`, because migrations create the request roles
     ([api/README.md §7](../api/README.md));
   - **app role**: what the Worker connects as, **without** `BYPASSRLS`, a member of the
     request roles ([DATA-MODEL.md §5.3](../api/DATA-MODEL.md)).
4. Note three connection strings from Neon › the branch › *Connection details*:
   - the migration role, **direct** (not pooled), on `dev` → `DEV_DATABASE_URL`;
   - the test branch's string → `TEST_DATABASE_URL`;
   - the app role, **pooled**, on `dev` → for Hyperdrive (§2.4).
5. Note the two hostnames, from `DEV_DATABASE_URL` and `TEST_DATABASE_URL`. They become
   `ALLOWED_MIGRATION_HOST` and `ALLOWED_TEST_HOST`.

### 2.4 Hyperdrive and R2

1. **Hyperdrive** already exists: its id is in `wrangler.jsonc` › `env.dev` › `hyperdrive`. To
   make it again:
   ```bash
   wrangler hyperdrive create dripfunnel-dev --connection-string="<app role pooled string>"
   ```
   Then put the new id in `env.dev`, in a pull request.
2. **R2**: `wrangler r2 bucket create dripfunnel-assets-dev`, then add
   `"r2_buckets": [{ "binding": "ASSETS", "bucket_name": "dripfunnel-assets-dev" }]` to
   `env.dev`. **Not done yet** (#277): until then, uploads such as partner logos fail on dev.
   Create the bucket before adding the binding, or the deploy fails.

### 2.5 GitHub environment `dev`

Repository › Settings › Environments › *New environment* › `dev`:

1. **Deployment branches:** `dev` only.
2. **Secrets:**

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from §2.2 |
   | `DEV_DATABASE_URL` | the migration role's direct string (§2.3) |
   | `TEST_DATABASE_URL` | the test branch's string (§2.3) |

3. **Variables:**

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | the dev account's id (dashboard › account overview) |
   | `ALLOWED_MIGRATION_HOST` | the hostname in `DEV_DATABASE_URL` |
   | `ALLOWED_TEST_HOST` | the hostname in `TEST_DATABASE_URL`; it must differ from the one above |

### 2.6 First deploy

1. Actions › **dev** › *Run workflow* on `dev` (or push to `dev`). This creates the Worker
   `dripfunnel-api-dev` and the three Pages projects.
2. The Worker refuses requests until its values are set (§3). That's expected at this point.

### 2.7 Put the consoles on their hostnames

Once the three Pages projects exist, attach `dev-store`, `dev-platform` and `dev-admin` to
them and create their DNS records:

```bash
CLOUDFLARE_API_TOKEN=<token from §2.2> CLOUDFLARE_ACCOUNT_ID=<dev account id> \
DEV_ZONE_ID=<dripfunnel.ai zone id> DEV_DOMAIN=dripfunnel.ai \
pnpm --filter ./apps/api dev-env:attach
```

Running it again is safe. The Worker's `/api/*` routes on those hosts come from `wrangler.jsonc`.

---

## 3. The Worker's values

Every value the Worker reads lives on the Worker itself, never in a file: Cloudflare dashboard
› Workers & Pages › **`dripfunnel-api-dev`** › Settings › **Variables and Secrets** › *Add*. A
deploy keeps them (`keep_vars`), and saving one deploys it at once. From a terminal,
`wrangler secret put <NAME> --env dev` (in `apps/api`) writes to the same place.

Never reuse a value from local or production.

| Name | Type | Dev value | How to get it |
|---|---|---|---|
| `ADMIN_HOST` | Text | `dev-admin.dripfunnel.ai` | fixed |
| `PLATFORM_HOST` | Text | `dev-platform.dripfunnel.ai` | fixed |
| `HOOKS_HOST` | Text | `dev-hooks.dripfunnel.ai` | fixed |
| `HYPERDRIVE_REQUIRED` | Text | `1` | fixed: the dev Worker has its binding |
| `CREDENTIALS_KEK` | Secret | a new key | `openssl rand -base64 32`. Keep a copy in the team's password manager: losing it makes every stored 2-factor secret and credential on dev unreadable |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Secret | the staff registration | Entra admin center › App registrations (THIRD-PARTY-ACCESS.md §2.5). Its redirect URIs must include `https://dev-admin.dripfunnel.ai/api/auth/callback` |
| `STRIPE_SECRET_KEY` | Secret | **test-mode** restricted key `rk_test_…` | Stripe › Developers › API keys › *Create restricted key*, with the permissions in §8 |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_…` | Stripe (test mode) › Developers › Webhooks › *Add endpoint* `https://dev-hooks.dripfunnel.ai/stripe`, with the events in §8 and *Listen to events on Connected accounts* › *Reveal signing secret* |
| `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | Secret | the sending IAM user, SES sandbox | THIRD-PARTY-ACCESS.md §2.4. In the sandbox only verified recipients receive mail: verify the team's addresses |
| `SES_SENDER_DOMAIN` | Text | a domain verified in that SES account | SES › Identities › *Create identity* › Domain, then its DKIM records in DNS |
| `EMAIL_SUPPRESSION_KEY` | Secret | a new key | `openssl rand -base64 32`; keys the suppression list's hashes. Email doesn't send without it |
| `SES_EVENTS_TOPIC_ARN` | Secret | the dev bounce topic's ARN | SNS topic with `SignatureVersion` 2, the configuration set's event destination, subscribed to `https://dev-hooks.dripfunnel.ai/ses` (THIRD-PARTY-ACCESS.md §2.4) |

Leaving out a whole group (all of Entra, Stripe or SES) switches that feature off: it answers
"not connected" instead of failing. Leaving out part of a group does the same, so set each
group whole.

The consoles' two build flags (`VITE_STATE_HARNESS=1` and `VITE_ADMIN_URL=https://dev-admin.dripfunnel.ai`)
are meant to be set in the dev build (THIRD-PARTY-ACCESS.md §8), but **`dev.yml` doesn't set
them yet**. Until it does, dev bundles have no `?state=` harness, and the portals' staff-session
links point at production's admin console.

---

## 4. Deploying and checking

1. Merge a pull request into `dev`. To redeploy without a change, use Actions › **dev** › *Run
   workflow*.
2. Watch the run. A failure at **Guard rails** means the `ALLOWED_*` variables are wrong; at
   **Gates**, a test failed; at **Migrations**, a migration failed (see
   [ROLLBACK.md](../code/ROLLBACK.md) before trying again).
3. Check the API. Access gates the hosts, so open this in a browser where you're signed in to
   Access:
   `https://dev-platform.dripfunnel.ai/api/health` → `{"ok":true,"area":"platform","db":"ok",…}`.
   `db: "missing"` means the Hyperdrive binding was lost; a 500 usually means a required value
   (§3) is missing.
4. Watch the Worker's logs: `pnpm --filter ./apps/api exec wrangler tail --env dev`.

---

## 5. Data on dev

- Migrations run on every deploy. They must work with the version already running
  (AGENTS.md "Data").
- **Sample data:** ARCHITECTURE.md §6 says dev is seeded once and re-seeded only by a manual
  workflow. **Neither exists yet:** `pnpm seed` refuses any database that isn't on your machine,
  and there is no seed workflow. *(decide)*
- **The first staff member:** staff sign in only once their Microsoft account is linked to a
  `staff_user` row, which accepting an invitation does. Invitation emails aren't sent until
  #274, and nothing yet creates the first super admin on an empty database. *(decide)*

---

## 6. Checklist

- [ ] Cloudflare dev account, `dripfunnel.ai`, SSL Full (strict), Access applications (§2.1)
- [ ] Deploy token (§2.2)
- [ ] Neon `dev` and test branches, migration and app roles, three connection strings (§2.3)
- [ ] Hyperdrive id in `env.dev`; R2 bucket and binding (§2.4)
- [ ] GitHub environment `dev`: three secrets, three variables (§2.5)
- [ ] First deploy (§2.6)
- [ ] `dev-env:attach` (§2.7)
- [ ] Every Worker value in §3
- [ ] `/api/health` shows `db: "ok"` (§4)

---

## 7. Open questions

1. How dev gets its sample data, and the re-seed workflow ARCHITECTURE.md §6 describes (§5). *(decide)*
2. How the first super admin is created on an empty dev database (§5). *(decide)*
3. Setting the two build flags in `dev.yml` (§3). *(decide)*
