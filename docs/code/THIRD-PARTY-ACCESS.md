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

Last updated: 2026-10-05.

---

## 1. Rules for every credential

These restate [../ARCHITECTURE.md](../ARCHITECTURE.md) §7 and the AGENTS.md security rules.

| Rule | Consequence |
|---|---|
| **Secrets live in Workers secrets or Cloudflare Secrets Store** | Never in the repo, a bundle, `.npmrc`, logs, error messages or a store repo |
| **One set per environment** | local, preview, staging and production each get their own. Local and preview use test or sandbox modes only |
| **Least scope the provider allows** | One Worker holds every secret, so each token is narrowed to exactly what it calls: named permissions, named zones, named accounts |
| **No secret in an SPA or a storefront** | Only publishable identifiers (Stripe publishable key, public store key, analytics IDs) may reach a browser |
| **Credentials partners and merchants give us are encrypted at rest** | A partner's AI, courier, SMS/WhatsApp, Google sign-in and support-chat credentials (§4) and a merchant's payment, courier, AI and Shopify credentials (§3) go in Postgres, encrypted with a platform key-encryption key (§5). They are never shown again after saving, only a masked hint and "connected on" |
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
| **Storefront deploy tokens** (runtime), one per pool account | Publishing preview and live storefront builds to each store's **Cloudflare Pages project** (one per store, decided 2026-10-05 on #284; stores spread over a pool of Cloudflare accounts as one nears its project limit, staff alerted at 80% (decided 2026-10-05 on #337); [../api/PLATFORM-PROMPT.md](../api/PLATFORM-PROMPT.md) §5.6) | API token per account, scoped to *Pages: Edit* on that account | Worker secret `CF_PAGES_POOL`, every account's id and token in one (§8.2). **Never in a store repo**: the platform deploys the build's artifact itself (PLATFORM-PROMPT §5.6, the hand-off *(proposed, INF 2 confirms)*) | 6 |
| **Cache purge token** (runtime) | Purging storefront caches after publish, the degraded-store edge rule, removing hidden products | API token, scoped to *Cache Purge* (plus *Zone Rulesets: Edit* if degraded pages are edge rules) | Worker secret | 6 |
| **Cloudflare for SaaS** on the zone | Custom hostnames with automatic certificates for every partner and merchant host | Plan add-on | — | 4 |
| — | Wildcard custom hostnames (`*.preview.<partnerdomain>`, `*.shops.<partnerdomain>`) may need **Enterprise**; per-hostname price at thousands of stores | **Verify** ([../USERS-AND-DOMAINS.md](../USERS-AND-DOMAINS.md) §5) | — | **Lead time**: contract |
| ~~**Workers for Platforms**~~ | **Not used**: storefronts are a Pages project per store (decided 2026-10-05 on #284) | — | — | — |
| **R2 buckets**, per environment | Assets, imports, exports, invoices, activity-log archive. **Assets wired on #219** as the `ASSETS` binding: `local` uses wrangler's local R2 (`dripfunnel-assets-local`); **create `dripfunnel-assets-dev` and `dripfunnel-assets`, then add the binding to `env.dev` and `env.prod`** (a binding to a missing bucket fails the deploy; until then brand uploads answer `NOT_CONNECTED`) | Worker binding (no key) | `wrangler.jsonc` | 5 |
| **R2 S3 API keys** *(decide)* | Only if browsers upload directly with presigned URLs (large imports, photos); a binding can't sign URLs | Access key ID + secret, scoped to the named bucket | Worker secret | 5 |
| **Cloudflare image resizing** (decided 2026-10-05 on #337) | Product photo variants for the storefront and portal, from originals in R2 through one core image component | Zone setting | — | 6 |
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
| **Package read access for store repos** | `pnpm install` of `@dripfunnel/storefront-core` in each store's CI. The App grants per-repo package access; a read-only token as a repo secret only if INF 0 finds that impossible (decided 2026-10-05 on #337) ([ARCHITECTURE.md](ARCHITECTURE.md) §5) | Package permission, or a fine-grained read-only token | Repo setting, or a store repo secret written by provisioning | 6 |
| **Actions minutes and storage** | Storefront builds, and possibly the AI designer sandbox (§2.6). Build minutes are a platform metric and a cost | Billing | — | 6, 9 |
| Turborepo remote cache *(optional)* | Faster CI | Vercel token or a self-hosted cache | GitHub Actions secret | 1 |

### 2.4 Amazon SES (email)

SES sends every email for every partner, from DripFunnel's own account; a partner gives only its
sender domain's DNS records (§4). **Needed now** (decided 2026-10-04 on #272): the outbox already
holds invitations (partner owner, partner team, staff, store owner), password resets, lock notices
and plan, store, card and payout notices that nothing sends; **#274** builds the sender.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **AWS account** and one SES region *(decide: e.g. `eu-west-1` or `ap-south-1`; data residency matters)* | Every email: verification, invitations, resets, order emails, receipts, trial and dunning | Account | — | 4 |
| **SES production access** | Leaves the sandbox, where SES only sends to verified addresses | Support request with use case, bounce handling and volumes | — | **Lead time**: days |
| **IAM user for sending** | The Worker signs SES v2 HTTP calls with SigV4 (`integrations/ses`). Workers can't use IAM roles; SMTP over a TCP socket would be possible but was **rejected on 2026-10-05 (#274)**: one HTTP request per email, no extra dependency, and the bounce hook and partner identities need the HTTP API anyway | Access key ID + secret, policy limited to `ses:SendEmail` / `ses:SendRawEmail` on the platform's identities and configuration set. **In the sandbox SES also checks the recipient's identity**, so the resource is `identity/*` until production access, then the sender domain's identity; a missing grant answers `AccessDeniedException` (logged as `email_refused`) | Worker secrets | 4 |
| **IAM permissions for identities** (same or a second user) | Creating and checking each partner's sender-domain identity and its DKIM records ([../api/SAAS.md](../api/SAAS.md) §3.6) | `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:DeleteEmailIdentity` | Worker secrets | 11 |
| **Sender domain** `SES_SENDER_DOMAIN` (production: `dripfunnel-mail.com`), verified in SES with DKIM, SPF, DMARC | DripFunnel's own email from `no-reply@<it>`; every partner's merchants' email from its fallback `no-reply@<partner label>.<it>` until the partner's own domain has an SES identity (SAAS §3.6). SES lets a verified domain's subdomains send | DNS records on our zone | — | 4 |
| **Configuration set + SNS topic** subscribed to `https://hooks.dripfunnel.com/ses` | Permanent bounces and complaints add the address's keyed hash (`EMAIL_SUPPRESSION_KEY`) to `email_suppression`, and it gets no merchant notice again; invitations, resets and lock notices still go (`src/hooks/ses.ts`, built on #274). Make the configuration set the sender domain's **default**, with an SNS event destination for Bounce and Complaint; set the topic's **`SignatureVersion` to 2** (the hook refuses SHA-1); subscribe the hook over HTTPS, which confirms itself | The topic's ARN as `SES_EVENTS_TOPIC_ARN`: the hook reads only that topic, since SNS signs every account's messages | Worker secret | 7 |
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
| — | Redirect URIs: `https://admin.dripfunnel.com/api/auth/callback`, `https://dev-admin.dripfunnel.ai/api/auth/callback` (ARCHITECTURE §6) and `https://admin.localhost/api/auth/callback` for local dev (`pnpm dev:https`, docs/api/README.md §7) | — | — | — |
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

**Decided 2026-10-04 on #272: DripFunnel holds no AI key of its own.** On a partner's plans that
include AI, the **partner's** key pays (§4); on plans without it, the merchant brings their own
(§3.3). The house partner's key is that partner's credential like any other.

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **The partner's AI provider key** (Anthropic, or another provider) | Every AI call on the partner's plans that include AI; metered per run in `ai_run` ([../api/SAAS.md](../api/SAAS.md) §9.2) | API key per partner | Partner credential in Postgres (§4, #275) | 9 (portal helpers can come earlier, in 5) |
| — | The designer agent runs in **GitHub Actions** (decided 2026-10-05 on #284). The partner's (or merchant's) key is handed to that run only, never stored in a store repo or its workflows | — | — | 9 |
| Cloudflare AI Gateway *(optional)* | Caching, rate limits and a cost log in front of the provider | Gateway ID; authenticated gateway token | Worker secret | 9 |
| A second provider (e.g. OpenAI) *(optional)* | A partner may connect one too, for fallback or cheaper translation models | API key | Partner credential (§4) | later |
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
| **Stripe Tax** (chosen for US sales tax on #184) | Tax on DripFunnel's own invoices (VAT, GST per payer country, SAAS §7.2), on this account. Also US sales tax at merchants' checkouts (decided on #184; each merchant's nexus set up), **on the merchant's own Stripe account through Connect** (decided 2026-10-05 on #284), so DripFunnel is never the tax vendor for merchants; what a store taking US payments only through PayPal uses is still open (SAPI 7) | Enabled on DripFunnel's account for its invoices; on each merchant's connected account for its checkouts | — | 11 |
| **Customer portal** configuration *(optional)* | Stripe-hosted "manage card / invoices" | Config | Stripe | 11 |

**Registered so far: nothing** (#201, 2026-10-04). The Worker reads `STRIPE_SECRET_KEY` (the
restricted key, `rk_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`) as Worker secrets; without them
the billing writes answer `NOT_CONNECTED` and `hooks.dripfunnel.com/stripe` doesn't exist. The
restricted key needs write on Accounts (Connect, Custom), Customers and Payment Methods, and read
on Charges, Invoices and Payouts. The webhook endpoint listens for `invoice.*`, `charge.*`,
`payout.*` (Connect) and `account.*` (Connect). Billing's retry schedule is set to four attempts
until SAAS §7.3's dunning policy is decided. The publishable key and Stripe.js reach the console
with the Billing wiring (#204).

### 2.8 Services still to choose

Each row is an open question in the specs. Each needs an account and key once chosen.

| Need | Where it's specified | Candidates | Credentials | Lead time |
|---|---|---|---|---|
| **SMS and WhatsApp one-time codes** — **each partner's own account** (decided 2026-10-04 on #272: the sender name is the partner's, and DLT and Meta verification are per business; credentials in §4) | Shoppers' order updates (confirmed, shipped, delivered) (decided 2026-10-05 on #337); Portal sign-up phone code and the SMS variant of two-step sign-in (ACCESS.md §2; the authenticator-app variant needs no provider); shoppers' mobile + code sign-in (ACCESS.md §2.1); **MSG91 (India) and Twilio (US)**, decided 2026-10-05 on #284 | Twilio Verify, MSG91, Gupshup, Vonage | Account ID + auth token or API key; sender IDs per country | **India: DLT registration** (entity ID, sender header, every template approved) takes weeks; US: A2P 10DLC or toll-free verification; EU: alphanumeric sender registration in some countries |
| **WhatsApp messages** — **the partner's own WhatsApp Business account** (§4) | Abandoned-cart reminders in India (Carts prototype), shipping with email in the first release (decided 2026-10-05 on #337); WhatsApp codes (ACCESS §2.1) | Meta WhatsApp Cloud API directly, or a BSP (Gupshup, Twilio, MSG91) | Meta Business Manager, WhatsApp Business Account ID, phone number ID, **permanent system-user access token**, **app secret** (webhook signature) | **Meta business verification** and **per-template approval**; display name per sender. per partner (decided on #272) |
| **Exchange rates** | Automatic currency conversion, "rates updated 2 hours ago" (CATALOG-DESIGN §3 fact 26, *(release: decide)*) | ECB reference rates (free, no key, EUR base, daily), Open Exchange Rates, Fixer, currencyapi | API key (none for ECB) | — |
| **Duties and import taxes at checkout** | Business plan feature (Pricing, SetMarkets, designed 2026-10-02: from each product's classification code or a flat percentage of the basket, with a de-minimis threshold); the provider behind it is still to choose | Zonos, Avalara Cross-Border, Stripe Tax (limited) | API key | Contract |
| **Search engine** (only if Postgres full-text isn't enough) | PLATFORM-PROMPT §5.4 "Typesense later" | Typesense Cloud | Admin key (server) + search-only scoped keys | later |
| **Logpush destination** | ARCHITECTURE §8 *(confirm)* | R2 (nothing extra), Axiom, Better Stack, Datadog | Ingest token | 12 |
| **Error tracking** *(proposed, not in specs)* | Exceptions from the Worker and SPAs with request and store IDs, no personal data | Sentry | DSN (public in SPAs), auth token for source-map upload in CI | 1 |
| **Support chat and help centre** — **the partner's own widget** (decided on #272: merchants contact their partner's support, never DripFunnel's; credentials in §4) | Pricing promises a "Help centre", "Email", "Chat", "Priority chat & phone" per plan | Intercom, Crisp, Zendesk, Help Scout | Workspace token; identity-verification secret (HMAC of the user ID) | 11 *(ask)* |
| **Status page** *(proposed)* | "Stripe is slow" / "Microsoft isn't answering" style notices, and our own uptime (Partner plan: uptime guarantee) | Better Stack, Instatus, Atlassian Statuspage | API token | 12 |

### 2.9 Google (portal sign-in)

"Continue with Google" appears on the portal (ACCESS.md §2, PortalAuth prototype) and possibly
on the partner console (*(ask)*, platform/README).

| Item | What it is for | Kind | Kept in | Slice |
|---|---|---|---|---|
| **Google Cloud project** with an OAuth consent screen ("External", verified) | People (merchants, vendors) sign in with Google | Project | — | 4. **Lead time**: brand verification if sensitive scopes; only `openid email profile` are needed |
| **OAuth client** (web), **one per partner** (decided 2026-10-04 on #272) | The sign-in flow; the consent screen shows the partner's name and the redirect URI is on the partner's own host | Client ID + **client secret** | Partner credential in Postgres (§4, #275) | 4 |
| — | ~~Redirect URIs on white-label hosts: a central callback, or one OAuth client per partner?~~ **One client per partner** (decided on #272): each partner registers `https://<portal host>/api/auth/google/callback` in its own Google Cloud project, so Google's per-client limits and the consent screen's name are the partner's | — | — | 4 |
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

Decided: the merchant's **own** accounts and keys
([../api/PLATFORM-PROMPT.md](../api/PLATFORM-PROMPT.md) §3.2, §5.4). **At launch (decided
2026-10-04 on #184, PLATFORM-PROMPT §8):** India and the US, with **Stripe** and **PayPal** (US),
**Razorpay**, **Cashfree**, **PhonePe** and **cash on delivery** (India), and **bank transfer**
(both). `apps/api/src/integrations/payments` plans one adapter each. Klarna and the DE region stay
in the Store prototype as a demo control only.

The Platform prototype's provider list also has Adyen.

| Provider | Region (prototype) | What the merchant gives | Webhook | Notes |
|---|---|---|---|---|
| **Stripe** | US (DE: prototype only) | Nothing pasted: the merchant connects through **Stripe Connect OAuth**, which returns to **one fixed redirect on the hooks host**, `https://hooks.<host>/stripe/connect/callback` (dev `dev-hooks.dripfunnel.ai`, prod `hooks.dripfunnel.com`) *(proposed on #287, SAPI 10 confirms)*: Stripe returns only to registered URLs and every partner's portal host differs, so the callback sends the merchant back to their own portal; the platform's `ca_…` id is `STRIPE_CONNECT_CLIENT_ID` (§8.2) | **One Connect endpoint** on DripFunnel's account, receiving every connected merchant account's events, each routed to its store by the connected account id; no per-store endpoints or secrets. *(Proposed, SAPI 10 confirms)*: the existing `hooks.<host>/stripe` endpoint, which already listens on connected accounts | **Stripe Connect Standard (OAuth)**, decided 2026-10-05 on #284, instead of pasted keys: no secret handling, one webhook, and Apple Pay / Google Pay **payment-method domain registration** per merchant domain through the API. Pasted keys need the merchant to register each domain |
| **Razorpay** | IN | Key ID, key secret | Webhook secret the merchant sets in Razorpay | Razorpay **Route** if vendors are paid out (PLATFORM-PROMPT §10 *(ask)*) |
| **Cashfree** | IN | App ID (client ID), secret key | Signed with the secret key | In the old plugins and the api layout |
| **PayPal** | US (DE: prototype only) | REST app client ID + secret | Webhook ID (verified through PayPal's API) | Or PayPal partner onboarding *(later)* |
| **Klarna** | DE | API username (UID) + password, region (EU/NA/OC) | Push/notification URLs | **Not at launch**: a Store-prototype demo control only (above); usually through Stripe or Adyen when the EU comes *(decide then)* |
| **PhonePe** | IN | Merchant ID, salt key + salt index (legacy), or client ID + secret (current PG API) | Callback checksum | — |
| **Adyen** | Platform prototype list | API key, merchant account, client key (public), HMAC key | HMAC | Usually for larger merchants |
| **Cash on delivery, bank transfer** | Cash on delivery IN; bank transfer IN and US (DE: prototype only) | No credential; bank details as text for the shopper | — | Orders stay "Payment pending" until marked paid (`orders.mark_paid`, ACCESS §5.1) |

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
| **Shiprocket** | IN | **The partner's account** (decided on #272, §4), not each merchant's: API user email + password (a dedicated API user); we exchange it for a token that lasts about 10 days and refresh it | Webhook for tracking, or polling as in the old plugin; needs the HSN code on products |
| **USPS** | US | USPS APIs OAuth client ID + secret, plus the account for labels (EPS/permit) | The old Web Tools user ID is retired |
| **UPS** | US | OAuth client ID + secret, shipper account number | — |
| **FedEx** | US | API key + secret key, account number (production keys need FedEx validation of labels) | **Lead time**: label certification |
| **Canada Post** | Platform prototype (US partner) | API username + password, customer number | — |
| **DHL** | DE | DHL Parcel DE: API key (app) + business customer user, password and EKP billing number; DHL Express: site ID + password, account number | Two different DHL APIs *(decide which)* |
| **DPD** | DE | Delis ID + password per country | — |
| **Hermes / Evri** | DE | API client ID + secret, customer number | — |
| **Österreichische Post** | Platform prototype (DE partner) | API client ID + secret, customer number | — |

The US carriers (USPS, UPS, FedEx) come **through one courier aggregator** (one aggregator decided
on #184; **EasyPost** (decided 2026-10-05 on #337)), and India uses **Shiprocket**. **Both are the partner's own accounts** (decided
2026-10-04 on #272, §4), stored encrypted per partner, never a DripFunnel key; a merchant's own
carrier account can be connected inside the partner's aggregator. The EU rows wait with the EU
region.

**Built on #305**: the adapters (`integrations/couriers/`: Shiprocket's serviceability rates after a login per quote,
since the Worker keeps nothing between requests; EasyPost's shipment rates, one carrier's at a time) and a store's choice
of couriers, which it connects only where its partner has the account. Until #275 reads partners' accounts none has one,
so a store can't connect a courier and checkout charges its flat rate; locally `COURIERS_LOCAL=1` gives every partner
both, quoting a fixed tariff ([setup/local.md](../setup/local.md) §6.1).

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
| **Shopify Partner account** and an app (public, or custom distribution) | DF | "Connect your Shopify store" read-only import (CatImport prototype, CATALOG-DESIGN part K; built on #301) | App **client ID + client secret** (`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, §8); scopes `read_products`, `read_inventory` (images come with `read_products`); allowed redirection URL `https://hooks.dripfunnel.com/shopify/callback` (dev: `https://dev-hooks.dripfunnel.ai/shopify/callback`) | **Public app review** by Shopify, including the mandatory privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) |
| **Per-merchant access token** | Merchant or supplier (by OAuth) | Reading their catalogue during import | Offline access token, sealed with `CREDENTIALS_KEK` in `external_connection`, **deleted once the import has read the shop, or after a day unused** (built on #301) | — |
| CSV import | — | "Import from a spreadsheet" | None | — |

### 3.5 Storefront analytics and marketing IDs

**Google Analytics 4, Meta Pixel and Google Tag Manager** ship, each loaded only after consent (decided 2026-10-05 on #337). Server-side events and feeds stay out of the first release.

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

**Decided 2026-10-04 on #272:** besides DNS, a partner brings its **own accounts** for the services
below. They are partner credentials, encrypted in Postgres with `CREDENTIALS_KEK` (§1, §5), never
environment variables. The partner's Owner or Admin enters them in the partner console
(Settings › Integrations); the admin console shows each one's status and staff may set them in a
setup session (ACCESS §8.2). Each shows a masked hint, its last check and *Test connection*, and is
never shown again once saved (**#275** builds the table, the APIs and both screens).

| Item | What it is for | Credential | Instead of |
|---|---|---|---|
| Portal host, preview and shop wildcards, sender domain ([../api/SAAS.md](../api/SAAS.md) §3.5) | White-label hosts and email (DripFunnel's SES sends from it) | DNS records only; no credential | — |
| **AI provider key** (Anthropic; optionally a second provider) | AI on the partner's plans that include it (§2.6); merchants on other plans bring their own (§3.3) | API key, with the partner's own spend limit | A DripFunnel platform key, which no longer exists |
| **Shiprocket** (India) | Rates, labels, pickups and tracking for the partner's Indian stores (§3.2) | API user email + password | A key per merchant |
| **US courier aggregator** (**EasyPost**, #337) | USPS, UPS and FedEx rates, labels and tracking (§3.2) | API key | A DripFunnel key |
| **SMS and WhatsApp sender** (MSG91, Twilio, Gupshup; WhatsApp Business) | Sign-up and two-step codes, shopper codes, WhatsApp reminders, in the partner's sender name (§2.8) | Account id + token or API key; sender ids, DLT entity and templates; WhatsApp phone-number id, system-user token and app secret | A DripFunnel sender |
| **Google sign-in OAuth client** | "Continue with Google" on the partner's portal host, its name on the consent screen (§2.9) | Client id + client secret, redirect URI on the partner's host | One DripFunnel client |
| **Support chat widget** (Intercom, Crisp, Zendesk, Help Scout) | Merchants chatting with their partner's support from the portal (§2.8) | Widget / app id (public) + identity-verification secret | A DripFunnel widget |
| **Payout account** (Platform prototype: IBAN or account number, "checked with a small test deposit") | Monthly payouts when DripFunnel bills on the partner's behalf | Through Stripe's own fields as a token (#201), never typed into our forms | — |
| Card for DripFunnel's charges to the partner | Partner billing | Stripe Elements (§2.7) | — |
| Partner's own billing system *(later, "partner bills its own merchants")* | How the platform learns a store's status (SAAS §14 *(ask)*) | A Platform API key we issue, or their webhook secret | — |
| Partner brand fonts, logos | Branding | None | — |

**The texts a partner registers (India's DLT; built on #289).** MSG91 sends only registered
templates, so each partner registers these six with its own sender header, word for word, the
variables in this order, and enters each template id with its MSG91 credentials (#275). Twilio
sends the same words as plain text. `apps/api/src/saas/sms/index.ts` holds the wording; a
change there needs every Indian partner to register it again.

| Message | Wording (variables numbered) |
|---|---|
| `code.second_factor`, `code.shopper_sign_in` | {1}: {2} is your sign-in code. It works for 10 minutes. Never share it. |
| `code.verify_phone` | {1}: {2} is your code to confirm this number. It works for 10 minutes. |
| `order.confirmed` | {1}: thanks for your order {2}. We'll text you when it ships. |
| `order.shipped` | {1}: order {2} is on its way with {3}. Track it: {4} |
| `order.delivered` | {1}: order {2} was delivered. Need help? {3} |

{1} is the sender's name (the partner's product, or the store's), and a code is 6 digits. The
`sms` outbox deliverer (`jobs/queues/deliverers/sms.ts`) picks MSG91 for `+91` numbers and Twilio
for the rest; it drops a code past its expiry, a refusal, and a partner with no account or
template, logging only a code, and retries an outage or a refused credential (401, 403). Until #275
reads the accounts, the Worker registers no `sms` deliverer and texts wait in the outbox, as email
waits without SES. A dropped text is recorded as given up, with its reason as `last_error`, never
as delivered. A code needs an expiry, and an order update unsent after 3 days is given up too (the
cron's sweep, which leaves a row the relay holds); once a text is sent or given up, its row keeps only
the message kind, never the number or the code.
Neither provider takes an idempotency key, so a crash between its acceptance and the row being marked
can text twice.

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
| Preview link signing key, `PREVIEW_LINK_KEY` (previews are gated by a signed link, decided 2026-10-05 on #284; storefront §4.1) | Signed preview URLs from the portal | 6 (ST 1a, INF 2) |
| Shopper session token signing (if not opaque) | Storefront shopper sessions (storefront §5) | 7 |

---

## 6. When each is needed

Start the lead-time items (**bold**) at the beginning, whichever slice uses them.

| Slice (PLATFORM-PROMPT §8) | Needs |
|---|---|
| 1. Monorepo, deploy pipeline | Cloudflare account, zone, CI deploy token; GitHub Team; (Sentry) |
| 2. Engine skeleton | Queues, Workflows, KV bindings |
| 3. Tenancy core | Neon project, app and migration roles, Neon API key, Hyperdrive; KEK; CSRF secret |
| 4. Signup, sign-in, invitations | **SES production access**, IAM send key, fallback sender domain; Google OAuth client; **SMS adapters: MSG91 (India) and Twilio (US)** (phone code, 2FA; decided 2026-10-05 on #284); Turnstile; custom hostnames token for the house partner's portal host |
| 5. Catalogue, inventory, tax | R2 (and S3 keys if presigned uploads); exchange rates; Anthropic key for product helpers |
| 6. Shop API, storefront, hosting, domains | **GitHub App**; package access; storefront deploy tokens (`CF_PAGES_POOL`); cache purge; **Cloudflare for SaaS (wildcard plan check)**; image resizing |
| 7. Cart, checkout, payments, shipping, orders, emails | Merchant payment adapters in test mode (Stripe, PayPal, Razorpay, Cashfree, PhonePe; cash on delivery and bank transfer need no account); the house partner's **Shiprocket** and aggregator test accounts (§4); SES configuration set and SNS; **WhatsApp** through MSG91 for cart reminders (decided 2026-10-05 on #337); **Stripe Tax** in test mode for US checkouts, on each merchant's connected account (§2.7) |
| 8. Offers | None new |
| 9. AI designer, sync bot | Each partner's AI key and spend limit (the house partner's first, §4); designer sandbox in GitHub Actions (decided 2026-10-05 on #284) |
| 10. Headless: API keys, webhooks, apps | Our own generated secrets only |
| 11. Billing, DF Admin, white label | **Stripe account activation and Connect review**, Billing keys and webhooks; **staff identity provider** and Cloudflare Access; SES identity permissions for partner domains; support chat tool |
| 12. Search, import/export, reporting | **Shopify app review**; Logpush destination; (Typesense) |

---

## 7. Open questions

1. **Staff identity provider**: Microsoft Entra ID (docs) or Microsoft Entra ID (Admin
   prototype)? (§2.5)
2. ~~**SMS and WhatsApp provider** to recommend to partners.~~ **MSG91 (India) and Twilio (US)**,
   adapters built in the first release (decided 2026-10-05 on #284). ~~Whether each partner needs its own
   sender~~: yes, the partner's own account (#272, §4). (§2.8)
3. ~~**Google sign-in on white-label hosts**: a central callback, or a client per partner?~~
   A client per partner (#272). (§2.9)
4. ~~**Merchant Stripe**: pasted keys (decided so far) or Stripe Connect OAuth?~~ **Connect OAuth**
   (decided 2026-10-05 on #284). (§3.1)
5. ~~**Where the AI designer runs**~~ **GitHub Actions** (decided 2026-10-05 on #284); the key is
   the partner's or merchant's, handed to the run (§2.6)
6. **How store repos deploy to Cloudflare** without holding a platform token: *(proposed, INF 2
   confirms)* the build uploads an artifact and the platform deploys it (PLATFORM-PROMPT §5.6).
   How they read the package: SC 0 decides. (§2.1, §2.3)
7. ~~**Couriers**: a direct integration per courier, or one aggregator?~~ An aggregator for the US and
   Shiprocket for India, both the partner's accounts (#184, #272). Which DHL API, when the EU comes? (§3.2)
8. **Exchange rates and duties providers.** ~~US sales tax~~: Stripe Tax (#184), on the merchant's own account through Connect (#284). (§2.8)
9. **Logpush destination, error tracking, support chat and status page.** (§2.8)
10. **SES region**, and whether EU partners need EU sending and storage.

---

## 8. Every variable, key and secret, by name

The one list of every value the code reads, with what it is for, how to make it, where it is
kept and what reads it. **Decided 2026-10-04 on #272**: there is no central env file. Each app
that reads values has its own **`.env.example`** (dummy values, committed) and **`.env.local`**
(your real local values, gitignored): `apps/api` and the three consoles in `apps/ui/*`. A value
two apps use is repeated in each. **A new variable is added to its app's `.env.example` and to
this table in the change that first reads it.**

Where it is kept:

- **Worker variable / Worker secret** (dev, prod): the Cloudflare dashboard › **Workers & Pages ›
  `dripfunnel-api-dev` or `dripfunnel-api` › Settings › Variables and Secrets** › *Add*, type
  *Text* or *Secret*. Read at runtime. `wrangler.jsonc` holds **bindings only** and sets
  `keep_vars`, so a deploy never deletes what is set there; the Worker refuses to start if a
  required value is missing (`core/config.ts`). From a terminal, `wrangler secret put <NAME>
  --env dev` writes the same place.
- **Feature Worker**: set by the `feature-env` workflow when it creates the Worker: the hosts in
  its generated config, and a fresh `CREDENTIALS_KEK`. Integrations it leaves unset (Entra,
  Stripe, SES) answer `NOT_CONNECTED`.
- **Local**: `apps/api/.env.local` (copy `apps/api/.env.example`). `pnpm dev`, the scripts and
  the tests load it themselves; nothing to export. A value already in your shell wins.
- **GitHub secret / var**: only what CI uses before or around the Worker (deploying, migrations,
  feature databases, the review): repository → Settings → Environments → `dev`, `prod` or
  `feature`. Migrations moving into the Worker is #276.
- **Build var**: the consoles' two public flags, `VITE_STATE_HARNESS` and `VITE_ADMIN_URL`, read
  at build time (decided on #272): `apps/ui/<app>/.env.local` locally, the CI build step
  otherwise. Compiled into the public bundle, so **never** a secret.
- **Your shell profile**: personal tokens (`GITHUB_PAT`).

### 8.1 Read by the code today

| Name | Role, and the least scope it needs | How to make it | Kept in (local · dev · prod) | Read by |
|---|---|---|---|---|
| `ADMIN_HOST`, `PLATFORM_HOST`, `HOOKS_HOST` | Which hostname is which API; the router answers 404 elsewhere (ARCHITECTURE §2) | Fixed per environment: `*.localhost`, `dev-*.dripfunnel.ai`, `*.dripfunnel.com` | `.env.local` · Worker variable · Worker variable | `core/config.ts` |
| `HYPERDRIVE_REQUIRED` | `"1"` where a Hyperdrive binding exists, so losing it turns `/health` red (#30) | — | `.env.local` · Worker variable · Worker variable once prod's binding exists | `core/config.ts` |
| `HYPERDRIVE` *(binding)* | Postgres through Hyperdrive. Holds the Neon **pooled** string of the app role, without `BYPASSRLS` (§2.2) | `wrangler hyperdrive create <name> --connection-string=<pooled url>`, then its id in `wrangler.jsonc` | Cloudflare; `wrangler.jsonc` names it | `index.ts`, `db/client.ts` |
| `ASSETS` *(binding)* | R2 bucket for uploads, exports and invoices (§2.1) | `wrangler r2 bucket create dripfunnel-assets-dev` (and `dripfunnel-assets`) | `wrangler.jsonc` | `index.ts` (brand uploads) |
| `HEALTH_RATE_LIMITER`, `SIGN_IN_RATE_LIMITER`, `STAFF_SESSION_RATE_LIMITER` *(bindings)* | Rate limits on `/health`, sign-in and codes, and the staff-session routes (ARCHITECTURE §7) | Declared in `wrangler.jsonc` `ratelimits` | `wrangler.jsonc` | `index.ts` |
| `CF_VERSION_METADATA` *(binding)* | The running Worker version, for `/health` and logs | Declared in `wrangler.jsonc` | `wrangler.jsonc` | `index.ts` |
| `CREDENTIALS_KEK` | Encrypts 2-factor secrets and every merchant credential at rest (§5). One per environment; never reused across them | `openssl rand -base64 32` | `.env.local` · Worker secret · Worker secret | `core/config.ts`, `auth/secretBox.ts` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Staff sign-in to the admin console (§2.5). Single-tenant registration, `openid profile email`, the `amr` optional claim | Entra admin center → App registrations → New (single tenant) → redirect URIs from §2.5 → *Certificates & secrets* → New client secret (copy it once; 24 months at most) | `.env.local` (optional) · Worker secret · Worker secret | `core/config.ts`, `integrations/entra` |
| `STRIPE_SECRET_KEY` | DripFunnel's Stripe account: Connect accounts, customers, payment methods; reads charges, invoices, payouts (§2.7). A **restricted** key (`rk_`), test mode outside prod | Stripe Dashboard → Developers → API keys → *Create restricted key*, with write on Accounts, Customers, Payment methods and read on Charges, Invoices, Payouts, Refunds | `.env.local` (optional, test) · Worker secret (test) · Worker secret (live) | `core/config.ts`, `integrations/stripe` (since #201) |
| `STRIPE_WEBHOOK_SECRET` | Verifies events at `hooks.<host>/stripe` (SAAS §7.2) | Stripe → Developers → Webhooks → *Add endpoint* `https://hooks.dripfunnel.com/stripe` (dev: `https://dev-hooks.dripfunnel.ai/stripe`) with `invoice.*`, `charge.*`, `payout.*`, `account.*` and *Listen to events on Connected accounts* → *Reveal signing secret*. Locally `stripe listen --forward-to localhost:8787/stripe --headers "Host: hooks.localhost"` prints one (the Worker picks the API by host, [setup/local.md](../setup/local.md) §8) | `.env.local` (optional) · Worker secret · Worker secret | `core/config.ts`, `hooks/stripe.ts` (since #201) |
| `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | Every email the outbox holds (§2.4, #274). An IAM user limited to `ses:SendEmail`/`ses:SendRawEmail` on the sender domain's identity. **All with `SES_SENDER_DOMAIN` and `EMAIL_SUPPRESSION_KEY`, or email waits in the outbox** | IAM → Users → *Create user* with that inline policy → *Security credentials* → *Create access key*; the region is the SES account's | `.env.local` (optional; the SES sandbox) · Worker secret (sandbox, verified recipients) · Worker secret (production access) | `core/config.ts`, `integrations/ses`, `jobs/queues/deliverers/email.ts` |
| `SES_SENDER_DOMAIN` | The domain email is sent from: DripFunnel's `no-reply@<it>`, partners' fallbacks `no-reply@<label>.<it>` (SAAS §3.6) | A domain verified in that SES account (SES → Identities → *Create identity* → Domain, then its DKIM records). Locally, any domain you can add DNS records to | `.env.local` · Worker variable · Worker variable (`dripfunnel-mail.com`) | `core/config.ts`, `saas/email` |
| `EMAIL_SUPPRESSION_KEY` | Keys the HMAC-SHA-256 the suppression list stores instead of an address (migrations/0034), so the table can't confirm a guessed address without it. One per environment, never reused. Losing it only stops old rows matching, which is safe. **Needed with the four `SES_*` values for email to send** | `openssl rand -base64 32` | `.env.local` · Worker secret · Worker secret | `core/config.ts`, `db/scoped/emailSuppression.ts` |
| `SES_EVENTS_TOPIC_ARN` | The one SNS topic `hooks/<host>/ses` reads bounces and complaints from (§2.4) | SNS → Topics → *Create topic* (Standard, `SignatureVersion` 2) → its ARN | — (SNS can't reach your machine) · Worker secret · Worker secret | `core/config.ts`, `hooks/ses.ts` |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Connect Shopify (§3.4, CATALOG K7): the OAuth app and the callback's signature check. Without both, Connect Shopify says it isn't set up and `hooks.<host>/shopify/callback` doesn't exist | Shopify Partners → Apps → *Create app* → *Configuration*: App URL the portal, allowed redirection URL from §3.4, scopes `read_products`, `read_inventory` → *Client credentials* | `.env.local` (optional, a development store) · Worker secret · Worker secret | `core/config.ts`, `integrations/shopify`, `hooks/shopify.ts` (since #301) |
| `SHOPIFY_LOCAL` | `1` answers Connect Shopify with a logging stand-in: approval comes straight back, the shop is empty. It skips Shopify's signature, so the Worker refuses to start with it unless `HOOKS_HOST` is on `localhost`; set, it wins over the two values above | — | `.env.local` only · — · — | `core/config.ts`, `index.ts` |
| `EMAIL_LOCAL` | `1` sends email through a local stand-in: the outbox, templates and relay run as on dev, and each email prints in the `pnpm dev` terminal and `apps/api/.local-mail/` (docs/setup/local.md §6.1). Needs `EMAIL_SUPPRESSION_KEY`; the Worker refuses to start with it unless `HOOKS_HOST` is on `localhost`; set, it wins over SES | — | `.env.local` only · — · — | `core/config.ts`, `index.ts`, `integrations/local` |
| `SMS_LOCAL` | `1` delivers texts through a local stand-in: each partner has an account on both providers, and the composed text prints instead of reaching MSG91 or Twilio. Local only, as above | — | `.env.local` only · — · — | `core/config.ts`, `index.ts`, `integrations/local` |
| `DNS_LOCAL` | `1` answers a `*.localhost` name with what its partner domain record expects, so a partner's local addresses verify through the real check, and lets a partner add `*.localhost` addresses. With the `CF_*` values set, a `*.localhost` portal host is live at once and never sent to Cloudflare. Every other name goes to the real resolver and, with those values, to Cloudflare. Local only, as above | — | `.env.local` only · — · — | `core/config.ts`, `index.ts`, `integrations/local`, `saas/partnerDomains` |
| `SEED_PASSWORD` | Optional, at least 10 characters: `pnpm --filter ./apps/api seed` gives every active seeded merchant, supplier and partner user this password. Read by the seed only, never the Worker | — | `.env.local` only · — · — | `scripts/seed/local.ts` |
| `DATABASE_URL` | The local Postgres the migrate, seed and session scripts and the integration tests use. **Never** Neon or `dbpg01` locally (AGENTS.md rule 3) | Your local Postgres 18 (api/README §7) | `.env.local` · — · — | `scripts/*`, `tests/support/database.ts` |
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | What `wrangler dev --env local` uses in place of the Hyperdrive binding. Needs a password in the URL, even a dummy one | Same local Postgres as above | `.env.local` | wrangler |
| `GITHUB_PAT` | Each developer's own GitHub token for Claude Code's GitHub MCP server: issues, pull requests and projects on `dripfunnel/platform` only (§2.11) | GitHub → Settings → Developer settings → Fine-grained tokens, 90 days at most ([GITHUB-MCP.md](GITHUB-MCP.md)) | Your shell profile, never a file in the repo | `.mcp.json` |
| `ALLOWED_MIGRATION_HOST` | The one remote host migrations may touch; anything else fails closed (§2.2) | The hostname of `DEV_DATABASE_URL` or `PROD_DATABASE_URL` | — · GitHub var `dev` · GitHub var `prod` | `scripts/migrate/host-guard.ts` |
| `ALLOWED_TEST_HOST` | The disposable test branch's host; the gates step passes it to the runner as `ALLOWED_MIGRATION_HOST` (§2.2) | The hostname of `TEST_DATABASE_URL` | — · GitHub var `dev` · GitHub var `prod` | `dev.yml`, `prod.yml` |
| `ALLOW_REMOTE_MIGRATIONS`, `CI` | `"1"` with `CI=true` lets migrations reach the allowed remote host; locally both stay off | Set by the workflow step | — · workflow · workflow | `scripts/migrate/host-guard.ts` |
| `CLOUDFLARE_API_TOKEN` | Deploys. One per GitHub environment, each on its own Cloudflare account and scoped as §2.1 lists (prod: Workers Scripts, Pages, Routes, Queues/Workflows/Hyperdrive; dev and feature: the `dripfunnel.ai` zone) | Cloudflare → My Profile → API Tokens → *Create token* → custom, with §2.1's permissions on the named account and zone only | — · GitHub secret `dev` and `feature` · GitHub secret `prod` | `dev.yml`, `feature-env.yml`, `prod.yml`, `promote.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | Which account a deploy targets | Cloudflare dashboard → the account's overview → *Account ID* | — · GitHub var · GitHub var | the same workflows |
| `DEV_DATABASE_URL`, `PROD_DATABASE_URL` | Migrations before each deploy, as the migration role over Neon's **direct** connection (§2.2) | Neon → the project → the branch → *Connection details* → role `migrator`, direct (not pooled) | — · GitHub secret `dev` · GitHub secret `prod` | `dev.yml`, `prod.yml` |
| `TEST_DATABASE_URL` | The disposable branch the CI gates run against (§2.2) | Neon → a branch made for tests → *Connection details* | — · GitHub secret `dev` · GitHub secret `prod` | `dev.yml`, `prod.yml` |
| `NEON_API_KEY`, `NEON_PROJECT_ID` | Creating and deleting each feature environment's branch, in the dev project only (§2.2) | Neon → the dev project → Settings → *API keys* → project-scoped key; the project id from its settings | — · GitHub secret / var `feature` · — | `feature-env.yml`, `scripts/feature-env` |
| `FEATURE_DOMAIN`, `FEATURE_ZONE_ID` | The `dripfunnel.ai` zone feature environments live in ([FEATURE-ENVIRONMENTS.md](FEATURE-ENVIRONMENTS.md)) | Cloudflare dev account → the zone → overview → *Zone ID* | — · GitHub var `feature` · — | `feature-env.yml`, `scripts/feature-env` |
| `FEATURE_DATABASE_URL` | The feature branch's connection string, handed between the workflow's own steps | Output of the Neon branch step; nothing to set | — · workflow · — | `scripts/feature-env` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude's review on every pull request (§2.6). Personal and expiring; reviews run as whoever minted it | `claude setup-token` on a Pro or Max subscription | — · GitHub repository secret · — | `ci.yml` |
| `GITHUB_TOKEN` | Per-run token GitHub makes for each workflow | Nothing to make or set | — | `ci.yml`, `naming.yml` |
| `VITE_STATE_HARNESS` | `"1"` builds the `?state=` harness into a console; dev and feature builds only, never production | — | Build var (feature and dev builds) | `apps/ui/*/src/harness.ts`, `shared/ui/screenState.ts` |
| `VITE_ADMIN_URL` | Where the portals' staff-session links lead outside `vite dev`; https only, defaults to production | The admin console's address for that build | Build var | `shared/ui/adminConsoleUrl.ts` |

### 8.2 Not read yet

Named now so each card uses the same name. The rest join their app's `.env.example` in the card that first reads them. Each row's role, scope and
generation are in the section it cites. *First needed* names a slice (§6) for the rows that predate the Store strand, and a Store card (FIRST-RELEASE §20: INF 1, SAPI 10, ST 1a…) for the rows it added.

| Name | Role | Kept in | Section | First needed |
|---|---|---|---|---|
| `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET` | Store repos through the provisioning App | Ids as Worker variables; key and webhook secret as Worker secrets | §2.3 | slice 6 |
| `CF_CUSTOM_HOSTNAMES_TOKEN`, `CF_SAAS_ZONE_ID` | Partner and merchant custom hostnames | Worker secret; zone id as Worker variable | §2.1 | slice 4 |
| `CF_PAGES_POOL` | The Cloudflare accounts storefronts' Pages projects spread over (#337): a JSON list of `{ "accountId", "token" }`, each token scoped to *Pages: Edit* on its own account, the first entry the main account. Replaces a single `CF_STOREFRONT_DEPLOY_TOKEN` (named on #287) | Worker secret | §2.1 | INF 1 |
| `CF_CACHE_PURGE_TOKEN` | Purging storefront caches | Worker secret | §2.1 | INF 2 |
| `STRIPE_CONNECT_CLIENT_ID` | Merchants connect their own Stripe account by Connect OAuth (#284): the platform's `ca_…` id, test mode outside prod (named on #287) | Worker variable | §3.1 | SAPI 10 |
| `PREVIEW_LINK_KEY` | Signs and checks the preview storefront's links (#284, storefront ARCHITECTURE §4.1; HMAC-SHA-256 with the expiry in the link *(proposed, ST 1a confirms)*). One per environment (named on #287) | Worker secret | §5 | ST 1a / INF 2 |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | **Not needed** *(proposed, SAPI 10 confirms)*: connected merchant accounts' events arrive on the existing `hooks.<host>/stripe` endpoint, which already listens on connected accounts (`STRIPE_WEBHOOK_SECRET`); only a separate merchant endpoint would need it | Worker secret | §2.7, §3.1 | SAPI 10 |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe's hosted card and bank fields in Settings › Payout and payment | Build var (public) | §2.7 | when the Stripe account exists |
| `AI_GATEWAY_TOKEN` | Cloudflare AI Gateway in front of every partner's AI calls *(optional)* | Worker secret | §2.6 | slice 9 |
| `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` | Bot check on signup and codes *(proposed)* | Worker secret; site key as build var | §2.1 | slice 4 |
| `HANDOFF_SIGNING_KEY` | Signing one-time handoff tokens across hosts | Worker secret | §5 | slice 4 / 11 |

### 8.3 Partner credentials: in the database, never environment variables

Each partner's own accounts (§4), encrypted with `CREDENTIALS_KEK` in Postgres (#275). They have
no variable name: the partner enters them in the partner console, or staff in a setup session.

| Credential | Role | How the partner makes it | Read by *(when built)* |
|---|---|---|---|
| AI provider key | AI on its plans that include AI | Anthropic Console → its own organisation → API keys, with a spend limit | AI runs (`ai_run`) |
| Shiprocket API user | India rates, labels, tracking | Shiprocket → Settings → API → create an API user | Courier adapter |
| US courier aggregator key | USPS, UPS, FedEx through **EasyPost** (#337) | The aggregator's dashboard → API keys (production key) | Courier adapter |
| SMS / WhatsApp sender | Codes, shoppers' order updates and WhatsApp reminders in its name | The provider's console; DLT registration (India: the six templates in §4) and Meta business verification first | The `sms` deliverer (#289), registered by #275 |
| Google OAuth client | "Continue with Google" on its portal host | Google Cloud → APIs & Services → Credentials → OAuth client (web), redirect `https://<portal host>/api/auth/google/callback` | Portal sign-in |
| Support chat widget | Its support chat in the portal | The chat tool's settings → install / identity verification | The portal's chat widget |

Merchants' own payment, courier, AI and Shopify credentials (§3) are stored the same way.
