# Local setup

Running the whole platform on your own machine: the API Worker, the three consoles and a local
Postgres, with nothing pointing at dev or production (AGENTS.md "Working with the user" rule 3).

Last updated: 2026-10-06 (#420: every partner's merchant portal, the local stand-ins, adding a partner and a store).

What each value is for, and how to make the real ones, is in
[THIRD-PARTY-ACCESS.md §8](../code/THIRD-PARTY-ACCESS.md). How the Worker uses the database
(roles, row-level security, the migration guards) is in [api/README.md §7](../api/README.md).
This page is the order to do things in.

---

## 1. What you end up with

| What | Address | Started by |
|---|---|---|
| API Worker (every API, by hostname) | `http://localhost:8787` | `wrangler dev --env local` |
| Merchant portal (`apps/ui/store`), one per partner | `https://store.<partner>.localhost` with `pnpm dev:https` (e.g. `https://store.northstar.localhost`); `http://localhost:5173?as=owner` for the sample harness only | Vite, behind Caddy |
| Partner console (`apps/ui/platform`) | `http://localhost:5174`, or `https://platform.localhost` with `pnpm dev:https` | Vite |
| Admin console (`apps/ui/admin`) | `http://localhost:5175`, or `https://admin.localhost` with `pnpm dev:https` | Vite |
| Postgres 18 | `localhost:5432` (or the port you choose) | Homebrew, apt or the Windows installer |
| R2, rate limiters, version metadata | inside `wrangler dev` | Wrangler's local simulation |

Each console sends `/api` to the Worker on 8787 with its own hostname (`admin.localhost`,
`platform.localhost`), which is how the Worker knows which API to answer. A merchant portal is
the partner's own host, as on dev and prod: `https://store.northstar.localhost` reaches the Worker
as `store.northstar.localhost`, which finds Northstar by its portal address (ARCHITECTURE.md §2).
Browsers send every `*.localhost` name to your machine, so nothing goes in `/etc/hosts`.

---

## 2. Install the tools (once per machine)

1. **Node 22 or later.** Check with `node -v`.
2. **pnpm**, the version in the root `package.json` (`packageManager`). Run `corepack enable`
   and pnpm picks the right version itself.
3. **Postgres 18.** Version 18 exactly: migrations refuse any other major, because dev and
   production run 18 on Neon. No Docker.
   - **macOS:**
     ```bash
     brew install postgresql@18
     brew services start postgresql@18
     ```
     Homebrew keeps `postgresql@18` off your `PATH`, so its tools are at
     `/opt/homebrew/opt/postgresql@18/bin/` (Intel Macs: `/usr/local/opt/postgresql@18/bin/`).
     If another Postgres already uses port 5432, give 18 its own port: set `port = 5434` in
     `/opt/homebrew/var/postgresql@18/postgresql.conf`, then
     `brew services restart postgresql@18`.
   - **Debian/Ubuntu:** `sudo apt install postgresql-18`.
   - **Windows:** the postgresql.org installer, version 18.
4. **Chrome**, for the consoles. Safari refuses the `__Host-` session cookies on plain
   `http://localhost`.
5. **Caddy** (`brew install caddy`), for `pnpm dev:https`: the merchant portals (§7.3) and
   real Microsoft sign-in (§7.2) need HTTPS on their own hosts.

---

## 3. Create the database (once)

Use the port you chose in §2 (5432 below). On macOS, prefix each command with the Homebrew
path from §2 if it isn't on your `PATH`.

```bash
createuser -p 5432 -s dripfunnel_dev
createdb   -p 5432 -O dripfunnel_dev dripfunnel
psql       -p 5432 -d dripfunnel -c "alter user dripfunnel_dev with password 'dripfunnel_dev'"
```

On Debian/Ubuntu, run the first two as `sudo -u postgres …`. The role needs a password even
when Postgres trusts local connections: wrangler refuses a connection string without one.
These names match the defaults in `apps/api/.env.example`, so you won't need to edit them. You
can use your own role and database names, as long as you put them in `.env.local` (§4).

---

## 4. Write `apps/api/.env.local` (once)

1. Copy the example:
   ```bash
   cp apps/api/.env.example apps/api/.env.local
   ```
   The file is gitignored. Never commit it, and never copy dev or production values into it.
2. Go through it line by line:

   | Line | What to put locally |
   |---|---|
   | `ADMIN_HOST`, `PLATFORM_HOST`, `HOOKS_HOST` | Leave as `admin.localhost`, `platform.localhost`, `hooks.localhost`. |
   | `HYPERDRIVE_REQUIRED` | Leave `1`. |
   | `DATABASE_URL` | Your local database from §3, e.g. `postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel`. Change the port if you moved it. |
   | `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | The same host, port and database as `DATABASE_URL`, **with a password** (any password, if Postgres ignores it). |
   | `CREDENTIALS_KEK` | Your own key: `openssl rand -base64 32`. Never one from dev or production. |
   | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | **Delete these three lines** unless you have the real registration's values (§7.2). With them deleted, Microsoft sign-in is off and you sign in with a local session (§7.1). |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **Delete** unless you have Stripe **test-mode** values (§8). Without them, billing answers "not connected". |
   | `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_SENDER_DOMAIN` | Left commented out unless you have the SES values (§8.1). Locally the email stand-in sends instead (`EMAIL_LOCAL`). |
   | `EMAIL_SUPPRESSION_KEY` | Keep it, or your own `openssl rand -base64 32`: SES and the email stand-in both need it. |
   | `SES_EVENTS_TOPIC_ARN` | **Delete.** Bounces arrive through SNS, which can't reach your machine. |
   | `EMAIL_LOCAL`, `SMS_LOCAL`, `DNS_LOCAL` | Keep `1`: the local stand-ins (§6.1). Emails and texts appear in the `pnpm dev` terminal and `apps/api/.local-mail/`, and a partner's `*.localhost` addresses verify. Each wins over the provider's real values, and the Worker refuses to start with them anywhere but localhost. |
   | `SEED_PASSWORD` | Optional, at least 10 characters: every seeded merchant, supplier and partner user gets this password at the next seed (§5). Without it, they sign in after **Forgot password**. |
   | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Left commented out unless you have a Shopify app's values (and then remove `SHOPIFY_LOCAL`). Without them or `SHOPIFY_LOCAL`, Connect Shopify says it isn't set up. |
   | `SHOPIFY_LOCAL` | Keep `1` to try Connect Shopify without an app: approval comes straight back and the shop is empty, every call logged. It wins over the two values above, and the Worker refuses to start with it anywhere but localhost. |

   Keep a whole group or delete the whole group: two of the three Entra values switch nothing
   on. The example's placeholder values (`dummy…`, all-zero ids) make that feature fail, and
   the local check (§6) warns about them.
3. A value already set in your shell wins over the file. Nothing needs exporting: every script
   reads `.env.local` itself.

The three consoles need no `.env.local` under `pnpm dev`. Their two build flags
(`VITE_STATE_HARNESS`, `VITE_ADMIN_URL`) only matter for built bundles.

---

## 5. Set up (once, and after pulling new migrations)

```bash
pnpm setup:local
```

This runs, in order:

1. `pnpm install`;
2. the local check, in setup mode (§6): `.env.local` and the Postgres connection;
3. `migrate`: applies every migration in `apps/api/migrations` that isn't applied yet;
4. `seed`: loads the sample platform (partners, partner users, plans, stores, people, staff,
   activity). The seed replaces everything it owns on each run, so running it again gives you
   a clean sample. Then it finishes for your machine (`apps/api/scripts/seed/local.ts`):
   - each partner's addresses move from `.example` to `.localhost`, so Northstar's portal is
     `https://store.northstar.localhost`, Bazaar Cloud's `https://portal.bazaarcloud.localhost`, and
     so on (`select p.name, d.host from partner_domain d join partner p on p.id = d.partner_id where d.kind = 'portal'`);
   - with `SEED_PASSWORD` set, every active seeded person gets it.

It ends with `Seeded … partners, …`, `Moved … partner addresses to .localhost` and how seeded
people sign in. Running it again is safe.

---

## 6. Run

```bash
pnpm dev:https    # the Worker and the three apps behind https://admin.localhost, https://platform.localhost
                  # and every partner's https://store.<partner>.localhost: what you normally run
pnpm dev          # the same without Caddy: the consoles on localhost ports, no merchant portal
pnpm dev:api      # or one app on its own: dev:api, dev:store, dev:platform, dev:admin
```

The first `pnpm dev:https` asks for your password once, to trust Caddy's local certificate
authority. Caddy makes a certificate for each portal host on its first visit, and only for a
`.localhost` name (`scripts/local/Caddyfile`).

Before the Worker starts, `pnpm dev` runs `pnpm --filter ./apps/api check:local`
(`apps/api/scripts/local/`). The check stops with the problem and its fix when:

- `apps/api/.env.local` doesn't exist, or lacks a required line;
- a value would be refused by the Worker (e.g. a malformed Stripe key);
- a connection string isn't local, or Hyperdrive's has no password, or the two name different
  databases;
- Postgres isn't answering, isn't version 18, or lacks the database or role (the fix names the
  exact `createdb` or `createuser` command);
- a migration isn't applied;
- port 8787 is already taken, usually by another `pnpm dev`. Wrangler would quietly move to
  8788 while the consoles kept calling the old Worker on 8787.

Locally nothing fires the Worker's every-minute cron (`wrangler dev` never does), so `pnpm dev`
starts it with `--test-scheduled` and calls `/__scheduled` once a minute itself
(`apps/api/scripts/local/dev.ts`): the outbox (email, exports, domain checks) runs as on dev.

It warns and carries on when there is no sample data, or when a feature's values are partial or
still the example's placeholders. The consoles start with `--strictPort`, so a taken console
port is an error too, not a silent move to the next port.

### 6.1 Where emails, texts and domain checks go

With `EMAIL_LOCAL`, `SMS_LOCAL` and `DNS_LOCAL` (the defaults in `.env.example`), everything
runs as on dev up to the provider: the outbox, the every-minute relay, the templates in the
partner's look, the per-partner SMS provider (MSG91 for +91, Twilio otherwise), the domain-check
job. Only the last call is local (`apps/api/src/integrations/local/`):

- **Email and SMS** print in the `pnpm dev` terminal as a block, and each is kept as a file in
  `apps/api/.local-mail/` (gitignored), e.g.
  ```
  ── email to lena@juniperhome.example
     from "Northstar Shops" <no-reply@northstar.…>
     You're invited to Juniper Home
  …
  Accept and set your password: https://store.northstar.localhost/accept-invite?token=…
  ──
  ```
  They arrive within a minute: the relay runs once a minute, as on dev.
- **DNS:** a `*.localhost` name answers with what its partner domain record expects, so a new
  partner's addresses go from waiting to live through the real check. Every other name goes to
  the real resolver.

Check that it's up:

```bash
curl -H "host: admin.localhost" -H "cf-connecting-ip: 127.0.0.1" http://localhost:8787/api/health
# {"ok":true,"area":"admin","db":"ok","version":"…"}
```

`/api/health` is per API host; a request without `cf-connecting-ip` gets 400 by design.

---

## 7. Sign in

### 7.1 With a local session (staff and partner users, no Microsoft account needed)

1. Pick a seeded user:
   - **Staff** (admin console): `arjun@softobotics.example` (super admin),
     `priya@softobotics.example` (partner manager), `neha@softobotics.example` (support),
     `dev@softobotics.example` (read-only).
   - **Partner users** (partner console): `maya@northstar.example` (owner),
     `diego@northstar.example` (admin), `alex@northstar.example` (finance),
     `ravi@dripfunnel.example` (owner of the house partner).
2. Print a session cookie:
   ```bash
   pnpm --filter ./apps/api session arjun@softobotics.example             # admin console
   pnpm --filter ./apps/api session --partner maya@northstar.example      # partner console
   ```
   It refuses any database that isn't on your machine.
3. Open the console in Chrome (`http://localhost:5175` or `http://localhost:5174`), open
   DevTools › Console and run:
   ```js
   document.cookie = "<the printed line>; path=/; secure"
   ```
4. Reload.

Partner users can also sign in for real at `https://platform.localhost` with `SEED_PASSWORD`.

### 7.2 With real Microsoft sign-in (staff)

Microsoft sends the browser back to `https://admin.localhost/api/auth/callback`, so the admin
console has to be served there over HTTPS.

1. Ask whoever administers the Entra registration to add the redirect URI
   `https://admin.localhost/api/auth/callback` (THIRD-PARTY-ACCESS.md §2.5), and to give you the
   tenant id, client id and a client secret.
2. Put the three `ENTRA_*` values in `apps/api/.env.local`.
3. Link your Microsoft account to a seeded staff member. Sign-in matches staff by the
   account's **Object ID** (`staff_user.sso_subject`), not by email. Normally accepting a staff
   invitation links them, but no invitation email is sent yet (#274). Find your Object ID in
   the Entra admin center › Users › you, then, against your **local** database only:
   ```bash
   psql -p 5432 -d dripfunnel -c "update staff_user set sso_subject = '<your Object ID>' where email = 'arjun@softobotics.example'"
   ```
   You then sign in as that member, with that member's role. A reseed undoes the link.
4. `brew install caddy`, once.
5. Run `pnpm dev:https`. The first run asks for your password once, to trust Caddy's local
   certificate authority.
6. Open `https://admin.localhost` and sign in.

If `pnpm dev:https` stops, it says why: Caddy is missing, port 443 or 2019 is taken (often
another `pnpm dev:https`), or the certificate isn't trusted yet.

### 7.3 A merchant portal, as a seeded merchant

Every seeded partner is Live with its portal on `.localhost` (§5); its stores' people sign in
there, exactly as on dev. Nothing here is a shortcut.

1. Run `pnpm dev:https`.
2. Pick a store's owner (or manager, staff or supplier) and its partner's portal:
   ```sql
   select u.email, m.role_key, s.name as store, d.host as portal
   from membership m join "user" u on u.id = m.user_id join store s on s.id = m.store_id
   join partner_domain d on d.partner_id = s.partner_id and d.kind = 'portal'
   where m.status = 'active' and u.status = 'active' order by d.host, s.name limit 20;
   ```
   For example `jenna@harborcoffee.example`, owner of Harbor Coffee Co., on
   `https://store.northstar.localhost`.
3. Open the portal and sign in with `SEED_PASSWORD`; without one, use **Forgot password** and
   take the link from the terminal (§6.1).
4. The first sign-in asks for 2-factor, as on dev: an authenticator app, or a text whose code
   appears in the terminal.
5. A person in stores of more than one partner sees, on each partner's portal, only that
   partner's stores.

### 7.4 Add a new partner

The real onboarding (SAAS.md §3.2), through the consoles. What each step writes is under it; check
it with the query.

1. **Staff create the partner.** At `https://admin.localhost` (a Partner manager or Super admin,
   §7.1), Partners › **Create partner**: name (`Acme Commerce`), country, Owner name and email
   (`asha@acme.example`), **Send invitation now**.
   *Writes* `partner` (Draft), its `company` setup item, a `partner_user` invited as Owner, a
   `partner_invitation`, and the invitation email in `outbox`.
   ```sql
   select p.state, u.email, u.status from partner p join partner_user u on u.partner_id = p.id where p.name = 'Acme Commerce';
   ```
2. **The Owner accepts.** The email appears in the terminal within a minute (§6.1): open its
   `https://platform.localhost/accept-invite?token=…` link, choose a password, and turn on
   2-factor if the console asks.
   *Writes* the `partner_user` (active, with its password) and the invitation as accepted.
3. **The Owner works through setup** in the partner console's checklist:
   - **Domains** (`/domains`): portal `store.acme.localhost`, preview `preview.acme.localhost`,
     shops `shops.acme.localhost`, email sender `mail.acme.localhost`. On dev these are the
     partner's real domains; locally any `<name>.<partner>.localhost` works, as long as it isn't
     a bare `<partner>.localhost` (a portal or wildcard on a bare domain is refused, as on dev).
     *Writes* four `partner_domain` rows (waiting) and their `partner_domain_record` rows, and a
     `domain.recheck` per address in `outbox`. Within a minute the domain check turns each live
     (§6.1):
     ```sql
     select d.kind, d.host, d.status from partner_domain d join partner p on p.id = d.partner_id where p.name = 'Acme Commerce';
     ```
   - **Plans** (`/plans`): at least one plan with a price, made Live. Its limits must be within
     what DripFunnel's contract allows Acme (a new partner keeps "Powered by").
     *Writes* `plan`, `plan_version`, `plan_price`, `plan_entitlement`.
   - **Branding** (`/branding`): product name, colours that pass the contrast check, font,
     support email, and the terms and privacy links (the legal pages).
     *Writes* `partner_branding` and the `branding` and `legal` setup items.
   - **Test sign-up**: sign up a test store on `https://store.acme.localhost`, taking the email
     and mobile codes from the terminal. Until #421 is built, sign-up stays closed before Live
     and this check can't pass: the same on dev.
   ```sql
   select item, status from partner_setup_item i join partner p on p.id = i.partner_id where p.name = 'Acme Commerce' order by item;
   ```
4. **Submit for approval**, in the partner console. The go-live checks run first: portal host
   live, email domain live, a priced plan, legal pages, the test sign-up.
5. **Staff approve**, at `https://admin.localhost` › Partners › Acme Commerce › **Approve**, with a
   reason. *Writes* `partner.state = 'live'` and the activity entries; merchant sign-up opens on
   `https://store.acme.localhost`.

### 7.5 Add a store to a partner

For any Live partner: a seeded one (Northstar's owner `maya@northstar.example`, with
`SEED_PASSWORD`) or one added in §7.4.

1. **The partner creates the store.** At `https://platform.localhost`, Stores › **Create store**:
   store name (`Juniper Home`), country, plan, the owner's name and email
   (`lena@juniperhome.example`), trial days.
   *Writes* `store`, `store_subscription`, the `provision-store` `job`, the owner's `invitation`
   and its email in `outbox`.
   ```sql
   select s.name, s.status, j.state, j.step from store s left join job j on j.store_id = s.id where s.name = 'Juniper Home';
   ```
   Provisioning runs as jobs, as on dev; the store's page in the partner console follows it.
2. **The owner accepts.** The invitation appears in the terminal in the partner's look: open its
   `https://store.northstar.localhost/accept-invite?token=…` link, set a password, and turn on
   2-factor (a text code appears in the terminal).
   *Writes* the owner's `user` (active) and their `membership` (owner, active).
3. **The owner signs in** at the partner's portal; the store is in the store switcher. Repeat 1–2
   with the same email for a second store; on another partner's portal, they see only that
   partner's stores.
   ```sql
   select u.email, s.name, m.role_key, m.status from membership m join "user" u on u.id = m.user_id join store s on s.id = m.store_id where u.email = 'lena@juniperhome.example';
   ```

Once the partner is Live, a merchant can also sign up on their own at
`https://store.<partner>.localhost/signup`, with the codes from the terminal.

---

## 8. Optional: Stripe in test mode

1. Put a **test-mode** restricted key (`rk_test_…`) in `STRIPE_SECRET_KEY`
   (THIRD-PARTY-ACCESS.md §8 says which permissions it needs).
2. Install the Stripe CLI (`brew install stripe/stripe-cli/stripe`) and run `stripe login`.
3. Forward events to the local hooks API. The Worker picks the API by hostname, so the hooks
   host has to be sent as a header:
   ```bash
   stripe listen --forward-to localhost:8787/stripe --headers "Host: hooks.localhost"
   ```
4. Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` and restart `pnpm dev`.

---

### 8.1 Optional: real email through SES

1. Ask for the SES sandbox credentials (region, access key id and secret) and put them in
   `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, and your own `EMAIL_SUPPRESSION_KEY`
   (`openssl rand -base64 32`). Remove `EMAIL_LOCAL`: asked for, the stand-in wins.
2. `SES_SENDER_DOMAIN`: a domain verified in that SES account (SES › Identities). Emails come from
   `no-reply@<it>` and, for a partner's merchants, `no-reply@<partner label>.<it>`.
3. In the sandbox, SES delivers only to **verified recipients**: add your own address under SES ›
   Identities › *Create identity* › Email address and click the link it sends.
4. Restart `pnpm dev`. The outbox job runs every minute: invite yourself from the admin
   console's Staff page and the email arrives within a minute. A refusal is logged in the
   terminal as `email_refused` with SES's reason, e.g. `MessageRejected` for an unverified
   recipient.

## 9. Before you say a change works

```bash
pnpm turbo run build typecheck lint test
```

The API tests use the same local Postgres as `DATABASE_URL`.

---

## 10. When something goes wrong

| Symptom | Fix |
|---|---|
| The check says Postgres isn't answering | `brew services restart postgresql@18` (it can die silently), then check the port in `.env.local`. |
| The check says migrations aren't applied | `pnpm setup:local`, or just `pnpm --filter ./apps/api migrate`. |
| You want a clean sample again | `pnpm --filter ./apps/api seed`. |
| You want a completely empty start | `dropdb dripfunnel && createdb -O dripfunnel_dev dripfunnel` (with your port), then `pnpm setup:local`. |
| A console shows you as signed out after the Worker restarted | Sessions live in the database and survive restarts. A reseed replaces the seeded users, so make a new session (§7.1). |
| Sign-in page says sign-in is unavailable | The `ENTRA_*` values aren't set: use §7.1, or §7.2. |
| `/api/health` answers 400 | Add `-H "cf-connecting-ip: 127.0.0.1"`. |
| A merchant portal's page loads but every call answers 404 | No partner holds that host as a live portal: `select host, status from partner_domain where kind = 'portal'`. Reseed (§5), or wait a minute for a new partner's domain check (§6.1). |
| `https://store.<partner>.localhost` won't open | Run `pnpm dev:https`, not `pnpm dev`. The name must end in `.localhost`, and Chrome may need a moment for the first certificate. |
| A new partner's domain stays waiting | `DNS_LOCAL=1` in `.env.local`, the host ends in `.localhost`, and the relay has run (once a minute). |
| No email or text appears | Wait a minute (the relay runs once a minute), and check `EMAIL_LOCAL` / `SMS_LOCAL` are `1`. The files are in `apps/api/.local-mail/`. |
| A seeded merchant's password is refused | `SEED_PASSWORD` is read at seed time: set it, then reseed (§5). |
