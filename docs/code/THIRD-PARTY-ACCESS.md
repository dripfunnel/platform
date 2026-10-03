# THIRD-PARTY-ACCESS.md: every third-party account, token and key

This lists every outside account, credential and approval the platform needs. For each one
it says:

- what it is for,
- who owns it,
- where it is kept,
- which build slice first needs it,
- what must be applied for early because approval takes time.

It collects what the specs already decide. Where a spec leaves the provider open, the
provider is marked *(ask)* or *(decide)*. The list was built from `docs/` and from the
Claude Design prototypes in `../../designs/`.

Last updated: 2026-10-02.

---

## 1. Rules for every credential

These restate [../ARCHITECTURE.md](../ARCHITECTURE.md) §7 and the AGENTS.md security rules.

| Rule | Consequence |
|---|---|
| **Secrets live in Workers secrets or Cloudflare Secrets Store** | Never in the repo, a bundle, `.npmrc`, logs, error messages or a store repo |
| **One set per environment** | local, preview, staging and production each get their own. Local and preview use test or sandbox modes only |
| **Least scope the provider allows** | One Worker holds every secret, so each token is narrowed to exactly what it calls: named permissions, named zones, named accounts |
| **No secret in an SPA or a storefront** | Only publishable identifiers (Stripe publishable key, public store key, analytics IDs) may reach a browser |
| **Credentials merchants give us are encrypted at rest** | Payment, courier, AI and Shopify credentials go in Postgres, encrypted with a platform key-encryption key (§5). They are never shown again after saving, only a masked hint and "connected on" |
| **Every credential has an owner and a rotation date** | DF Admin shows its health, last check and rotation date, never its value ([../ui/admin/CONSOLE-DESIGN.md](../ui/admin/CONSOLE-DESIGN.md) R1) |
| **CI secrets live in GitHub Actions** | Only secrets CI itself needs: deploying, Neon branches, publishing the package. Store repos hold **no platform secret** ([../api/SAAS.md](../api/SAAS.md) §5 step 5) |

Legend:

- **Owner**: who holds the account. DF = DripFunnel, Partner, or Merchant.
- **Slice**: the build step in [../api/PLATFORM-PROMPT.md](../api/PLATFORM-PROMPT.md) §8 that
  first needs it.
- **Lead time**: approval or verification that takes days or weeks. Start it early.

---

## 2. Accounts DripFunnel must own

### 2.1 Cloudflare

This covers hosting, the API, jobs, files, domains and edge security.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Cloudflare account** on **Workers Paid** | Workers, Pages, Queues, Workflows, Hyperdrive, R2, KV, Cron, rate-limit bindings | Account | — | 1 |
| **Account ID** and **zone ID** for `dripfunnel.com` | Every API call and deploy | Identifier (not secret) | `wrangler.jsonc` and CI variables | 1 |
| **`dripfunnel.com` zone** on Cloudflare, and access to its registrar | admin, platform, hooks, the house partner's hosts, the fallback email domain | Account | — | 1 |
| **CI deploy token** (production account) | `prod.yml`: `wrangler versions upload` of the API Worker, from `main` only. `promote.yml`: `wrangler versions deploy` to promote that Worker version and `wrangler pages deploy` of the three Pages projects, triggered by hand ([ROLLBACK.md](ROLLBACK.md)) | API token, scoped to *Workers Scripts: Edit*, *Pages: Edit*, *Workers Routes: Edit* on the zone, *Queues/Workflows/Hyperdrive: Edit* | GitHub environment `prod` secret `CLOUDFLARE_API_TOKEN`, variable `CLOUDFLARE_ACCOUNT_ID` | 1 |
| **Cloudflare dev account** ("DripFunnel Dev", Workers Paid) with the **`dripfunnel.ai`** zone | Every feature environment **and the long-lived dev environment** (ARCHITECTURE §6), kept apart from production because tokens can't be narrowed to certain Workers ([FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md) §1) | Account | — | 1 |
| **Dev environment token** (dev account only) | The `dev` workflow: the Worker, the three Pages projects, and DNS and routes for `dev-*.dripfunnel.ai` | API token: *Account*: Workers Scripts Edit, Cloudflare Pages Edit, Hyperdrive Edit; *Zone `dripfunnel.ai`*: Zone Read, DNS Edit, Workers Routes Edit | GitHub environment `dev` secret `CLOUDFLARE_API_TOKEN` | 1 |
| **Feature environments token** (dev account only) | The `feature-env` workflow: Workers, Pages, Hyperdrive, DNS and routes for `<slug>-*.dripfunnel.ai` | API token: *Account*: Workers Scripts Edit, Cloudflare Pages Edit, Hyperdrive Edit; *Zone `dripfunnel.ai`*: Zone Read, DNS Edit, Workers Routes Edit | GitHub environment `feature` secret `CLOUDFLARE_API_TOKEN` | 1 |
| **Cloudflare Access on the dev account** | `*.dripfunnel.ai` for `@softobotics.com`, with a Bypass on `*-hooks.dripfunnel.ai` | Zero Trust org, one-time PIN login | Cloudflare | 1 |
| **Custom hostnames token** (runtime) | Creating, checking and deleting Cloudflare for SaaS custom hostnames for partner portal hosts and merchant domains ([../api/SAAS.md](../api/SAAS.md) §8) | API token, scoped to *SSL and Certificates: Edit* and *Custom Hostnames: Edit* on the SaaS zone only | Worker secret | 4 (partner hosts), 6 (merchant domains) |
| **Storefront deploy token** (runtime) | Publishing preview and live storefront builds; the hosting model is open: Pages per store, Worker per store, or Workers for Platforms ([../api/PLATFORM-PROMPT.md](../api/PLATFORM-PROMPT.md) §10) | API token, scoped to *Pages: Edit*, or *Workers Scripts: Edit* on the dispatch namespace | Worker secret. **Never in a store repo** (PLATFORM-PROMPT §5.6) *(decide how builds in store repos deploy without it, §7)* | 6 |
| **Cache purge token** (runtime) | Purging storefront caches after publish, the degraded-store edge rule, removing hidden products | API token, scoped to *Cache Purge* (plus *Zone Rulesets: Edit* if degraded pages are edge rules) | Worker secret | 6 |
| **Cloudflare for SaaS** on the zone | Custom hostnames with automatic certificates for every partner and merchant host | Plan add-on | — | 4 |
| — | Wildcard custom hostnames (`*.preview.<partnerdomain>`, `*.shops.<partnerdomain>`) may need **Enterprise**; per-hostname price at thousands of stores | **Verify** ([../USERS-AND-DOMAINS.md](../USERS-AND-DOMAINS.md) §5) | — | **Lead time**: contract |
| **Workers for Platforms** (if chosen) | One dispatch namespace for per-store storefront workers | Plan add-on | — | 6 |
| **R2 buckets**, per environment | Assets, imports, exports, invoices, activity-log archive. **Assets wired on #219** as the `ASSETS` binding: `local` uses wrangler's local R2 (`dripfunnel-assets-local`); **create `dripfunnel-assets-dev` and `dripfunnel-assets`, then add the binding to `env.dev` and `env.prod`** (a binding to a missing bucket fails the deploy; until then brand uploads answer `NOT_CONNECTED`) | Worker binding (no key) | `wrangler.jsonc` | 5 |
| **R2 S3 API keys** *(decide)* | Only if browsers upload directly with presigned URLs (large imports, photos); a binding can't sign URLs | Access key ID + secret, scoped to the named bucket | Worker secret | 5 |
| **Cloudflare Images** or image resizing *(ask, PLATFORM-PROMPT §10)* | Product photo variants for the storefront and portal | Zone setting, or Images API token | Worker secret (Images only) | 6 |
| **Hyperdrive config**, per environment | Pooling to Neon; holds the Neon **pooled** connection string (§2.2) | Binding; the string is set once through `wrangler hyperdrive create` | Cloudflare | 3 |
| **Rate-limit bindings and WAF rules** | Sign-in, signup, invites, password reset, send code, Shop API (ARCHITECTURE §7) | Config | `wrangler.jsonc` and zone | 3 |
| **Turnstile** site key + secret *(proposed)* | Bot check on signup, send-code and password reset, on top of rate limits. Not in the specs yet | Site key (public), secret key | Secret in a Worker secret; site key in the SPA | 4 |
| **Cloudflare Access** on `admin.dripfunnel.com` (recommended) | Extra gate in front of DF Admin | Zero Trust org, plus an identity provider connected to staff SSO (§2.5) | Cloudflare | 11 |
| **Access service token** *(decide)* | Lets CI smoke-test admin previews behind Access | Client ID + secret | GitHub Actions secret | 11 |
| **Logpush** job | Long-term technical logs. **Destination open** (LOGGING.md §7): R2 needs nothing more; a third party needs its token (§2.10) | Job config | Cloudflare | 12 |
| **Secrets Store** (optional) | Account-level secrets shared across environments instead of per-Worker secrets | — | — | 1 |

### 2.2 Neon (Postgres)

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Neon organisation and project**, on a paid plan | The system of record; staging and production as branches or separate projects *(decide)* | Account | — | 3 |
| **Neon dev project** `dripfunnel-dev` | Seeded dummy data on its default branch; one branch per feature environment ([FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md)) | Project | — | 1 |
| **Neon API key** (scoped to `dripfunnel-dev`) | The `feature-env` workflow creates, and later deletes, each feature environment's branch | Project-scoped API key | GitHub environment `feature` secret `NEON_API_KEY`, variable `NEON_PROJECT_ID` | 1 |
| **App role** connection string (pooled) | The Worker's runtime role, **without** `BYPASSRLS`, for row-level security ([../api/DATA-MODEL.md](../api/DATA-MODEL.md) §5) | Password | Inside the Hyperdrive config only | 3 |
| **Migration role** connection string (direct) | Owns the schema; runs `apps/api/migrations` before each deploy, over Neon's direct connection, not Hyperdrive | Password | GitHub environment `prod` secret, production environment only | 3 |
| **Persistent dev database** (`DEV_DATABASE_URL`) | The `dev` workflow's Migrations step runs `apps/api/migrations` against this Neon branch before each deploy; unlike `TEST_DATABASE_URL` above, this one is not disposable — it backs the shared dev environment | Password | GitHub environment `dev` secret | 1 |
| **Production database** (`PROD_DATABASE_URL`) | The `prod` workflow's Migrations step runs `apps/api/migrations` against this Neon branch before each deploy, using the migration role above, over the direct connection | Password | GitHub environment `prod` secret | 1 |
| **CI test database** (`TEST_DATABASE_URL`) | A dedicated, disposable Neon branch the `dev` workflow's Gates step (`build typecheck lint test`) runs against; separate from the persistent `dev` branch (`DEV_DATABASE_URL` above) and safe to write/reset freely. The gates apply migrations to it, so it is guarded by `ALLOWED_TEST_HOST` exactly as the deploy step is guarded by `ALLOWED_MIGRATION_HOST` | Password | GitHub environment `dev` secret | 1 |
| **`ALLOWED_TEST_HOST`** | The literal hostname of the disposable branch above. The gates refuse to run if `TEST_DATABASE_URL`'s host doesn't match it, so pointing that secret at the `dev` or prod branch fails closed instead of migrating it | Not a secret: a variable | GitHub environment `dev` variable | 1 |
| **`ALLOWED_MIGRATION_HOST`** | The literal hostname of `DEV_DATABASE_URL` above. The Migrations step refuses to run if that secret's host doesn't match it, so rotating or re-pointing the dev Neon branch without updating this variable fails closed instead of silently migrating the wrong host — this is the only place `DEV_DATABASE_URL`'s expected host is registered | Not a secret: a variable | GitHub environment `dev` variable | 1 |
| **`ALLOWED_MIGRATION_HOST`** (prod) | The literal hostname of `PROD_DATABASE_URL` above, same fail-closed purpose as the `dev` variable of the same name — a distinct GitHub environment variable, not shared with `dev` | Not a secret: a variable | GitHub environment `prod` variable | 1 |
| **CI test database** (`TEST_DATABASE_URL`, prod) | A dedicated, disposable Neon branch the `prod` workflow's own `gates` step (`build typecheck lint test`) runs against, since `main` isn't protected yet and this job can't rely on `ci.yml` having run; separate from `PROD_DATABASE_URL` and from `dev`'s own `TEST_DATABASE_URL`, and safe to write/reset freely. Guarded by `ALLOWED_TEST_HOST` (prod) exactly as `dev`'s is | Password | GitHub environment `prod` secret | 1 |
| **`ALLOWED_TEST_HOST`** (prod) | The literal hostname of the disposable branch above, same fail-closed purpose as the `dev` variable of the same name — a distinct GitHub environment variable, not shared with `dev` | Not a secret: a variable | GitHub environment `prod` variable | 1 |
| Read-only role *(proposed)* | Support and engineer-on-call investigations, reporting | Password | Password manager | 12 |

Local development uses a local Postgres (tests create a fresh database on it per run, and
need no Docker) and **never** Neon or
`dbpg01.softobotics.org` (AGENTS.md rule 3). The `dev` and `prod` workflows' own Gates steps
are the exception, and only because each `TEST_DATABASE_URL` is a disposable branch **pinned
by its own `ALLOWED_TEST_HOST`** — "it is disposable" is an intention, and the variable is
what makes it a control.

### 2.3 GitHub

GitHub holds the code, the store repos, builds and the package.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **`dripfunnel` org on GitHub Team** | Branch protection on `main` before the first deploy workflow ([../ARCHITECTURE.md](../ARCHITECTURE.md) §6) | Plan | — | 1 |
| **GitHub App** "DripFunnel Provisioning", installed on the org | Every repo operation. Short-lived installation tokens per request, never a token per store ([../api/SAAS.md](../api/SAAS.md) §2) | App ID, **private key (PEM)**, installation ID, **webhook secret** | Worker secrets (PEM, webhook secret); IDs as variables | 6 |
| — | Permissions to request: *Administration: write* (create and delete repos), *Contents: write*, *Workflows: write*, *Actions: read/write* (trigger builds), *Secrets: write* and *Variables: write* (repo config), *Pull requests: write* (sync bot), *Checks: read*, *Metadata: read*, and *Packages* if it can grant package read per repo | — | — | — |
| — | Webhook events: `workflow_run`, `check_suite`, `pull_request`, `push`, delivered to `hooks.dripfunnel.com/github` | — | — | — |
| **Claude GitHub App** (`github.com/apps/claude`), installed on `dripfunnel/platform` | **No longer needed by the review** (the `review` job in `ci.yml`) since #167's follow-up (2026-10-02): it runs the Claude Code CLI and comments with the workflow's own token ([WORKFLOW.md](WORKFLOW.md) §7). Kept installed for `@claude` mentions, if anyone uses them | App installation, no secret to keep | Installed by a repo admin; nothing stored | 1 |
| **Release workflow token** | Publishing `@dripfunnel/storefront-core` to GitHub Packages with attestations | Built-in `GITHUB_TOKEN` with `packages: write`, `id-token: write` | Workflow permissions | 6 |
| **Package read access for store repos** | `pnpm install` of `@dripfunnel/storefront-core` in each store's CI. **Verify** the App can grant per-repo package access; otherwise push a read-only token as a repo secret ([ARCHITECTURE.md](ARCHITECTURE.md) §5) | Package permission, or a fine-grained read-only token | Repo setting, or a store repo secret written by provisioning | 6 |
| **Actions minutes and storage** | Storefront builds, and possibly the AI designer sandbox (§2.6). Build minutes are a platform metric and a cost | Billing | — | 6, 9 |
| Turborepo remote cache *(optional)* | Faster CI | Vercel token or a self-hosted cache | GitHub Actions secret | 1 |

### 2.4 Amazon SES (email)

SES sends every email for every partner.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **AWS account** and one SES region *(decide: e.g. `eu-west-1` or `ap-south-1`; data residency matters)* | Every email: verification, invitations, resets, order emails, receipts, trial and dunning | Account | — | 4 |
| **SES production access** | Leaves the sandbox, where SES only sends to verified addresses | Support request with use case, bounce handling and volumes | — | **Lead time**: days |
| **IAM user for sending** | The Worker signs SES v2 HTTP calls with SigV4 (Workers can't use IAM roles or SMTP) | Access key ID + secret, policy limited to `ses:SendEmail` / `ses:SendRawEmail` on the platform's identities and configuration set | Worker secrets | 4 |
| **IAM permissions for identities** (same or a second user) | Creating and checking each partner's sender-domain identity and its DKIM records ([../api/SAAS.md](../api/SAAS.md) §3.6) | `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:DeleteEmailIdentity` | Worker secrets | 11 |
| **Fallback sender domain** (e.g. `mail.dripfunnel.com`), verified with DKIM, SPF, DMARC | Email for partners whose own domain isn't verified yet | DNS records on our zone | — | 4 |
| **Configuration set + SNS topic** subscribed to `hooks.dripfunnel.com/ses` | Bounces, complaints and deliveries, so we stop sending to bad addresses (`src/hooks/ses.ts`) | SNS subscription; verify the SNS message signature (no shared secret) | — | 7 |
| Partner sender domains | One verified SES identity per partner (`mail.<partnerdomain>`) | DNS records the partner adds; no credential | — | 11 |

### 2.5 Staff sign-in (DF Admin)

The staff identity provider is **Microsoft Entra ID** (decided 2026-10-01), settling a
disagreement in which the design prompts said Google Workspace and the Admin prototype
designed Entra with Microsoft Authenticator. The prototype won: it designs the flow in full,
including the failure states #17 already ships. Both prompts are corrected.

#13 built staff identity against a stubbed provider; **#89** wires the real exchange
(`apps/api/src/integrations/entra/`). The code is complete and tested against a fake Entra —
including that a token from another tenant is refused — and the Worker falls back to refusing
every sign-in as `provider_unconfigured` until the three secrets below are set, so the
registration is the only thing still outstanding.

**How the ID token is trusted** (decided 2026-10-01): its RS256 signature is verified against
the tenant key set with `jose`, then `iss`, `aud`, `exp`, `nonce` and `tid` are checked. OIDC
Core §3.1.3.7 would allow skipping the signature, because the token arrives straight from the
token endpoint over TLS; verifying it anyway means the check does not depend on the exchange
staying shaped that way.

**`tid` is checked on every token.** A registration left on "any Microsoft account" would
otherwise let a personal account reach the staff lookup.

**Add `amr` as an optional ID-token claim** on the registration (#39): the Staff list shows
whether each member's last sign-in used a second factor, read from `amr` containing `mfa`.
Without the claim every sign-in reads as without one, and the list warns accordingly.

The OIDC app's values below belong to the API Worker, and the Cloudflare Access client to
Cloudflare Zero Trust. The admin SPA needs none: it sends the browser to
the Worker's `/api` sign-in route, and the Worker redirects to the identity provider, handles
the callback and sets the session cookie. A `VITE_*` variable is built into the public
bundle, so the client secret must never be one. The tenant and client IDs aren't secret, but
the SPA has no use for them either.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Entra ID app registration** | Staff SSO with 2-factor on `admin.dripfunnel.com`; re-authentication before impersonation | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Worker secrets | 11 |
| — | Redirect URIs: `https://admin.dripfunnel.com/api/auth/callback`, `https://dev-admin.dripfunnel.ai/api/auth/callback` (ARCHITECTURE §6) and `https://admin.localhost/api/auth/callback` for local dev | — | — | — |
| — | Single tenant ("Accounts in this organizational directory only"), so `tid` cannot be another tenant's | — | — | — |
| **Same identity provider connected to Cloudflare Access** | The outer gate (§2.1) | A second OIDC client, or the same one | Cloudflare Zero Trust | 11 |
| Group or role claims — **not used** | Staff roles live in our own table: DATA-MODEL.md §3.1 puts `role_key` on `staff_user` and #39 builds invite and change-role against it | — | — | — |

### 2.6 AI provider

The AI runs the storefront designer and the portal's AI helpers.

In the prototypes it covers:

- the storefront designer: "Describe a change" and "describe your shop" at setup;
- "Write it for me" product descriptions;
- "Suggest a translation";
- the HS/HSN code "Find";
- A+ content suggestions.

AI is included from Growth Pro upward. On lower plans the merchant brings their own key (§3.3).

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Anthropic API account** (organisation, workspaces per environment, spend limits) | Every platform-paid AI call; metered per run in `ai_run` ([../api/SAAS.md](../api/SAAS.md) §9.2) | API key per environment | Worker secret | 9 (portal helpers can come earlier, in 5) |
| — | Where the designer agent runs is **open** (ARCHITECTURE §8): in GitHub Actions the key must be an org Actions secret exposed only to the designer workflow, never to store repos' own workflows; in Cloudflare Containers it stays a Worker or container secret | — | *(decide)* | 9 |
| Cloudflare AI Gateway *(optional)* | Caching, rate limits and a cost log in front of the provider | Gateway ID; authenticated gateway token | Worker secret | 9 |
| A second provider (e.g. OpenAI) *(optional)* | Fallback, or cheaper models for translation | API key | Worker secret | later |
| **`CLAUDE_CODE_OAUTH_TOKEN`** | Claude's review on every pull request ([WORKFLOW.md](WORKFLOW.md) §7, the `review` job in `.github/workflows/ci.yml`). **The check fails without it** (reversed 2026-09-30): the job stops in its first step with a message naming this secret, before installing or running anything. Minted from a Claude Pro or Max subscription with `claude setup-token`; it is **personal**, expires, and every review runs as whoever minted it | OAuth token | GitHub Actions secret on `dripfunnel/platform` | 1 |

### 2.7 Stripe: DripFunnel's own account

This account handles **platform** billing. Shoppers' payments are §3.1.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Stripe account for DripFunnel** (business verification, bank account; test and live mode) | **Stripe Billing**: merchant and partner subscriptions, invoices, dunning, usage overage ([../api/SAAS.md](../api/SAAS.md) §7) | Account | — | 11. **Lead time**: activation |
| **Restricted secret key**, per mode | Customers, subscriptions, invoices, payment methods, usage records; nothing else | `rk_…` | Worker secret | 11 |
| **Publishable key**, per mode | Stripe Elements or Checkout in the Billing screen, so the card never touches our servers (the prototype's Billing screen draws it as a hosted Stripe card field since 2026-10-02) | `pk_…` (public) | SPA build variable | 11 |
| **Webhook signing secret** for `hooks.dripfunnel.com/stripe` | Verifying billing events; idempotent through `billing_event` | `whsec_…` per endpoint and mode | Worker secret | 11 |
| **Stripe Connect** (platform) | "DripFunnel bills merchants on the partner's behalf" **ships first** (SAAS §7.1): partners are connected accounts, receive monthly payouts, and are verified by a test deposit (Platform prototype) | Connect enabled; Connect webhook secret; one connected account ID per partner | Worker secret; IDs in Postgres | 11. **Lead time**: Connect platform review |
| **Stripe Tax** *(ask: only if chosen)* | Tax on DripFunnel's own invoices (VAT, GST per payer country, SAAS §7.2) and/or US sales tax for merchants (§2.8) | Enabled on the account; same key | — | 11 |
| **Customer portal** configuration *(optional)* | Stripe-hosted "manage card / invoices" | Config | Stripe | 11 |

### 2.8 Services still to choose

Each row is an open question in the specs. Each needs an account and key once chosen.

| Need | Where it's specified | Candidates | Credentials | Lead time |
|---|---|---|---|---|
| **SMS and WhatsApp one-time codes** | Portal sign-up phone code and the SMS variant of two-step sign-in (ACCESS.md §2; the authenticator-app variant needs no provider); shoppers' mobile + code sign-in (ACCESS.md §2.1, *which provider? (ask)*) | Twilio Verify, MSG91, Gupshup, Vonage | Account ID + auth token or API key; sender IDs per country | **India: DLT registration** (entity ID, sender header, every template approved) takes weeks; US: A2P 10DLC or toll-free verification; EU: alphanumeric sender registration in some countries |
| **WhatsApp messages** | Abandoned-cart reminders in India (Carts prototype); WhatsApp codes (ACCESS §2.1) | Meta WhatsApp Cloud API directly, or a BSP (Gupshup, Twilio, MSG91) | Meta Business Manager, WhatsApp Business Account ID, phone number ID, **permanent system-user access token**, **app secret** (webhook signature) | **Meta business verification** and **per-template approval**; display name per sender. *(ask whether each partner or merchant needs its own number, because white label)* |
| **Exchange rates** | Automatic currency conversion, "rates updated 2 hours ago" (CATALOG-DESIGN §3 fact 26, *(release: decide)*) | ECB reference rates (free, no key, EUR base, daily), Open Exchange Rates, Fixer, currencyapi | API key (none for ECB) | — |
| **US sales tax** | CATALOG-DESIGN §3 fact 37; PLATFORM-PROMPT §10 *(ask)* | Stripe Tax, Avalara AvaTax, TaxJar | Account ID + licence key / API token, per merchant nexus set-up | Contract (Avalara) |
| **Duties and import taxes at checkout** | Business plan feature (Pricing, SetMarkets, designed 2026-10-02: from each product's classification code or a flat percentage of the basket, with a de-minimis threshold); the provider behind it is still to choose | Zonos, Avalara Cross-Border, Stripe Tax (limited) | API key | Contract |
| **Search engine** (only if Postgres full-text isn't enough) | PLATFORM-PROMPT §5.4 "Typesense later" | Typesense Cloud | Admin key (server) + search-only scoped keys | later |
| **Logpush destination** | ARCHITECTURE §8 *(confirm)* | R2 (nothing extra), Axiom, Better Stack, Datadog | Ingest token | 12 |
| **Error tracking** *(proposed, not in specs)* | Exceptions from the Worker and SPAs with request and store IDs, no personal data | Sentry | DSN (public in SPAs), auth token for source-map upload in CI | 1 |
| **Support chat and help centre** | Pricing promises a "Help centre", "Email", "Chat", "Priority chat & phone" per plan | Intercom, Crisp, Zendesk, Help Scout | Workspace token; identity-verification secret (HMAC of the user ID) | 11 *(ask)* |
| **Status page** *(proposed)* | "Stripe is slow" / "Microsoft isn't answering" style notices, and our own uptime (Partner plan: uptime guarantee) | Better Stack, Instatus, Atlassian Statuspage | API token | 12 |

### 2.9 Google (portal sign-in)

"Continue with Google" appears on the portal (ACCESS.md §2, PortalAuth prototype) and possibly
on the partner console (*(ask)*, platform/README).

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Google Cloud project** with an OAuth consent screen ("External", verified) | People (merchants, vendors) sign in with Google | Project | — | 4. **Lead time**: brand verification if sensitive scopes; only `openid email profile` are needed |
| **OAuth client** (web) | The sign-in flow | Client ID + **client secret** | Worker secret | 4 |
| — | **Redirect URIs on white-label hosts**: every partner portal host would need its own redirect URI, and Google caps and reviews them. The consent screen also shows *DripFunnel*, not the partner. *(decide)*: one central callback on a DripFunnel host that hands a one-time token back to the portal host, or one OAuth client per partner | — | — | 4 |
| Google sign-in for shoppers *(not in specs)* | Not planned (ACCESS §2.1 allows email + password and/or mobile + code) | — | — | — |

### 2.10 Development and CI tools

| Item | Credential |
|---|---|
| pnpm, Turborepo, Vitest, Playwright, a local Postgres 18 (docs/api/README.md §7) | None |
| Changesets | None (uses `GITHUB_TOKEN`) |
| Dependency and vulnerability scanning ("known critical vulnerabilities fail the build") | GitHub Dependabot/advisories (none), or Snyk/Socket token *(decide)* |
| Claude Design, Claude Code | Individual seats; not part of the product |
| Unsplash (`designs/image-slot.js`) | Prototype only; **not** needed by the product |
| GitHub MCP server for Claude Code (§2.11) | A **personal** fine-grained token per developer, in `GITHUB_PAT` |

### 2.11 GitHub MCP server for Claude Code (every developer)

[`.mcp.json`](../../.mcp.json) connects Claude Code to GitHub's remote MCP server with each
developer's **own** fine-grained token in `GITHUB_PAT` (issues, pull requests and projects on
`dripfunnel/platform` only, 90 days at most). Setup, use, troubleshooting and rotation:
[GITHUB-MCP.md](GITHUB-MCP.md).

---

## 3. Credentials merchants bring

Each merchant enters these in the portal. They are stored encrypted per store (§1) and are
used only by that store's calls. The region packs in the Store prototype decide which ones
appear.

### 3.1 Payment providers (Settings › Payment setup)

Decided: the merchant's **own** accounts and keys, Stripe and Razorpay first
([../api/PLATFORM-PROMPT.md](../api/PLATFORM-PROMPT.md) §3.2, §5.4). `apps/api/src/integrations/payments`
plans `stripe/`, `razorpay/` and `cashfree/`.

The Store prototype also shows:

- PayPal for US and DE,
- Klarna and bank transfer for DE,
- PhonePe, COD and bank transfer for IN.

The Platform prototype's provider list also has Adyen.

| Provider | Region (prototype) | What the merchant gives | Webhook | Notes |
|---|---|---|---|---|
| **Stripe** | US, DE | Secret or restricted key, publishable key | Signing secret per store endpoint (`hooks.dripfunnel.com/stripe/<store>`), or one Connect endpoint | *(decide)* **Stripe Connect Standard (OAuth)** instead of pasted keys: no secret handling, one webhook, and Apple Pay / Google Pay **payment-method domain registration** per merchant domain through the API. Pasted keys need the merchant to register each domain |
| **Razorpay** | IN | Key ID, key secret | Webhook secret the merchant sets in Razorpay | Razorpay **Route** if vendors are paid out (PLATFORM-PROMPT §10 *(ask)*) |
| **Cashfree** | IN | App ID (client ID), secret key | Signed with the secret key | In the old plugins and the api layout |
| **PayPal** | US, DE | REST app client ID + secret | Webhook ID (verified through PayPal's API) | Or PayPal partner onboarding *(later)* |
| **Klarna** | DE | API username (UID) + password, region (EU/NA/OC) | Push/notification URLs | Usually through Stripe or Adyen instead *(decide)* |
| **PhonePe** | IN | Merchant ID, salt key + salt index (legacy), or client ID + secret (current PG API) | Callback checksum | — |
| **Adyen** | Platform prototype list | API key, merchant account, client key (public), HMAC key | HMAC | Usually for larger merchants |
| **Cash on delivery, bank transfer** | IN, DE | No credential; bank details as text for the shopper | — | Orders stay "Payment pending" until marked paid |

**Vendor payouts** (Stripe Connect or Razorpay Route) would add connected accounts per
vendor. **Decided 2026-10-02: not in the platform for now.** A per-store supplier ledger
records refund overrides and the merchant settles outside (PLATFORM-PROMPT §5.4 Payments);
connected accounts come with a later card, if ever.

### 3.2 Couriers (Settings › Shipping › Delivery partners)

The prototypes show per courier: *Pricing*, *Standby*, *Login rejected* and *Not connected*.
They also show live rates at checkout from Growth Pro and label booking. Shiprocket comes
first (PLATFORM-PROMPT §5.4).

| Courier | Region | What the merchant gives | Notes |
|---|---|---|---|
| **Shiprocket** | IN | API user email + password (a dedicated API user); we exchange it for a token that lasts about 10 days and refresh it | Webhook for tracking, or polling as in the old plugin; needs the HSN code on products |
| **USPS** | US | USPS APIs OAuth client ID + secret, plus the account for labels (EPS/permit) | The old Web Tools user ID is retired |
| **UPS** | US | OAuth client ID + secret, shipper account number | — |
| **FedEx** | US | API key + secret key, account number (production keys need FedEx validation of labels) | **Lead time**: label certification |
| **Canada Post** | Platform prototype (US partner) | API username + password, customer number | — |
| **DHL** | DE | DHL Parcel DE: API key (app) + business customer user, password and EKP billing number; DHL Express: site ID + password, account number | Two different DHL APIs *(decide which)* |
| **DPD** | DE | Delis ID + password per country | — |
| **Hermes / Evri** | DE | API client ID + secret, customer number | — |
| **Österreichische Post** | Platform prototype (DE partner) | API client ID + secret, customer number | — |

A courier aggregator (EasyPost, Shippo, ShipEngine) *(decide)* would replace most of the US and
EU rows with **one DripFunnel API key** plus each merchant's carrier accounts connected
inside it.

### 3.3 The merchant's own AI key

On Starter (Free) and Growth, "the AI runs on your own OpenAI or Anthropic account" (Store
prototype, Pricing, PortalBilling).

| Provider | What the merchant gives | Notes |
|---|---|---|
| **Anthropic** | API key | Used only for that store's runs; metered the same way in `ai_run`; never logged |
| **OpenAI** | API key (project key) | Needs a second model adapter; the designer's prompts must work on both *(decide)* |

### 3.4 Shopify import ("Bring products from Shopify")

| Item | Owner | What it is for | Kind | Lead time |
|---|---|---|---|---|
| **Shopify Partner account** and an app (public, or custom distribution) | DF | "Connect your Shopify store" read-only import (CatImport prototype, CATALOG-DESIGN part K) | App **client ID + client secret**; scopes `read_products`, `read_inventory` (+ `read_files` for images) | **Public app review** by Shopify, including the mandatory privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) |
| **Per-merchant access token** | Merchant (by OAuth) | Reading their catalogue during import | Offline access token, encrypted, **deleted once the import finishes or is abandoned** | — |
| CSV import | — | "Import from a spreadsheet" | None | — |

### 3.5 Storefront analytics and marketing IDs

These are open questions (storefront/ARCHITECTURE §12 *(ask)*).

| Item | Kind | Notes |
|---|---|---|
| Google Analytics 4 measurement ID, Google Tag Manager container ID | Public ID | Loaded by storefront-core only after consent; the theme may not add scripts |
| Meta Pixel ID | Public ID | — |
| Meta Conversions API access token *(if server-side events)* | **Secret** | Would be stored like payment keys |
| Google Merchant Center / Meta catalogue feeds *(not designed, MISSING-FEATURES)* | OAuth grants | Later |

### 3.6 Things merchants set up without giving us a credential

- **Custom domain**: DNS records only (a CNAME to our Cloudflare for SaaS target plus the
  ownership record).
- **Outbound webhooks** and **API keys** in Settings › Developers: **we** generate these
  secrets (§5), shown once.

---

## 4. What partners provide

| Item | What it is for | Credential |
|---|---|---|
| Portal host, preview and shop wildcards, sender domain ([../api/SAAS.md](../api/SAAS.md) §3.5) | White-label hosts and email | DNS records only; no credential |
| **Payout account** (Platform prototype: IBAN or account number, "checked with a small test deposit") | Monthly payouts when DripFunnel bills on the partner's behalf | Collected by **Stripe Connect onboarding**, never typed into our forms |
| Card for DripFunnel's charges to the partner | Partner billing | Stripe Elements (§2.7) |
| Partner's own billing system *(later, "partner bills its own merchants")* | How the platform learns a store's status (SAAS §14 *(ask)*) | A Platform API key we issue, or their webhook secret |
| Partner brand fonts, logos | Branding | None |

---

## 5. Secrets the platform generates itself

These are not third-party, but the Worker needs each one per environment before the matching
slice.

| Secret | What it is for | Slice |
|---|---|---|
| **Credential key-encryption key** (KEK), with a version for rotation | Encrypting merchant payment, courier, AI and Shopify credentials, 2-factor secrets and the signup row's password (SAAS §4.1, DATA-MODEL §2) | 3 |
| CSRF secret / double-submit key | Cookie sessions (AGENTS.md security rules) | 3 |
| One-time handoff token signing key | Support and impersonation entry, Google-callback handoff across hosts (ACCESS.md §8) | 4 / 11 |
| Invitation, reset and verification tokens | CSPRNG, stored hashed; **no** key needed (ACCESS.md §6) | 4 |
| Merchant API key and app grant secrets | Shown once, stored hashed with a visible prefix (ACCESS.md §5.6) | 10 |
| **Outbound webhook signing secret** per endpoint | Merchants verify our webhooks | 10 |
| Public store key | Identifies a store to the Shop API; public, not a secret | 6 |
| Preview link signing key *(if previews are gated, storefront §12)* | Signed preview URLs from the portal | 6 |
| Shopper session token signing (if not opaque) | Storefront shopper sessions (storefront §5) | 7 |

---

## 6. When each is needed

Start the lead-time items (**bold**) at the beginning, whichever slice uses them.

| Slice (PLATFORM-PROMPT §8) | Needs |
|---|---|
| 1. Monorepo, deploy pipeline | Cloudflare account, zone, CI deploy token; GitHub Team; (Sentry) |
| 2. Engine skeleton | Queues, Workflows, KV bindings |
| 3. Tenancy core | Neon project, app and migration roles, Neon API key, Hyperdrive; KEK; CSRF secret |
| 4. Signup, sign-in, invitations | **SES production access**, IAM send key, fallback sender domain; Google OAuth client; **SMS provider** (phone code, 2FA); Turnstile; custom hostnames token for the house partner's portal host |
| 5. Catalogue, inventory, tax | R2 (and S3 keys if presigned uploads); exchange rates; Anthropic key for product helpers |
| 6. Shop API, storefront, hosting, domains | **GitHub App**; package access; storefront deploy token; cache purge; **Cloudflare for SaaS (wildcard plan check)**; image resizing |
| 7. Cart, checkout, payments, shipping, orders, emails | Merchant payment adapters (Stripe, Razorpay, Cashfree) in test mode; **Shiprocket** test account; SES configuration set and SNS; **WhatsApp** if shopper codes use it; tax service if chosen |
| 8. Offers | None new |
| 9. AI designer, sync bot | Anthropic production key and spend limits; designer sandbox (Actions or Containers) |
| 10. Headless: API keys, webhooks, apps | Our own generated secrets only |
| 11. Billing, DF Admin, white label | **Stripe account activation and Connect review**, Billing keys and webhooks; **staff identity provider** and Cloudflare Access; SES identity permissions for partner domains; support chat tool |
| 12. Search, import/export, reporting | **Shopify app review**; Logpush destination; (Typesense) |

---

## 7. Open questions

1. **Staff identity provider**: Microsoft Entra ID (docs) or Microsoft Entra ID (Admin
   prototype)? (§2.5)
2. **SMS and WhatsApp provider**, and whether each partner or merchant needs its own sender
   (ACCESS.md §2.1). (§2.8)
3. **Google sign-in on white-label hosts**: a central callback, or a client per partner?
   (§2.9)
4. **Merchant Stripe**: pasted keys (decided so far) or Stripe Connect OAuth? (§3.1)
5. **Where the AI designer runs**, which decides where the Anthropic key lives. (§2.6)
6. **How store repos deploy to Cloudflare** without holding a platform token (PLATFORM-PROMPT
   §5.6), and how they read the package. (§2.1, §2.3)
7. **Couriers**: a direct integration per courier, or one aggregator? Which DHL API? (§3.2)
8. **Exchange rates, US sales tax and duties providers.** (§2.8)
9. **Logpush destination, error tracking, support chat and status page.** (§2.8)
10. **SES region**, and whether EU partners need EU sending and storage.
