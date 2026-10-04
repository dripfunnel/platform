# Local setup

Running the whole platform on your own machine: the API Worker, the three consoles and a local
Postgres, with nothing pointing at dev or production (AGENTS.md "Working with the user" rule 3).

Last updated: 2026-10-04.

What each value is for, and how to make the real ones, is in
[THIRD-PARTY-ACCESS.md §8](../code/THIRD-PARTY-ACCESS.md). How the Worker uses the database
(roles, row-level security, the migration guards) is in [api/README.md §7](../api/README.md).
This page is the order to do things in.

---

## 1. What you end up with

| What | Address | Started by |
|---|---|---|
| API Worker (every API, by hostname) | `http://localhost:8787` | `wrangler dev --env local` |
| Merchant portal (`apps/ui/store`) | `http://localhost:5173` | Vite |
| Partner console (`apps/ui/platform`) | `http://localhost:5174`, or `https://platform.localhost` with `pnpm dev:https` | Vite |
| Admin console (`apps/ui/admin`) | `http://localhost:5175`, or `https://admin.localhost` with `pnpm dev:https` | Vite |
| Postgres 18 | `localhost:5432` (or the port you choose) | Homebrew, apt or the Windows installer |
| R2, rate limiters, version metadata | inside `wrangler dev` | Wrangler's local simulation |

Each console sends `/api` to the Worker on 8787 with its own hostname (`admin.localhost`,
`platform.localhost`), which is how the Worker knows which API to answer. Nothing goes in
`/etc/hosts`.

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
5. **Optional, for real Microsoft sign-in:** Caddy (`brew install caddy`), see §7.2.

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
   | `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_SENDER_DOMAIN` | **Delete** unless you have them; emails then wait in the outbox. To send for real, see §8.1. |
| `SES_EVENTS_TOPIC_ARN` | **Delete.** Bounces arrive through SNS, which can't reach your machine. |

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
   a clean sample.

It ends with `Seeded … partners, … partner users, … plans, … stores, …`. Running it again is
safe.

---

## 6. Run

```bash
pnpm dev          # the Worker and the three consoles
pnpm dev:https    # the same, behind https://admin.localhost and https://platform.localhost (§7.2)
pnpm dev:api      # or one app on its own: dev:api, dev:store, dev:platform, dev:admin
```

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

Check that it's up:

```bash
curl -H "host: admin.localhost" -H "cf-connecting-ip: 127.0.0.1" http://localhost:8787/api/health
# {"ok":true,"area":"admin","db":"ok","version":"…"}
```

`/api/health` is per API host; a request without `cf-connecting-ip` gets 400 by design.

---

## 7. Sign in

### 7.1 With a local session (no Microsoft account needed)

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
   `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`.
2. `SES_SENDER_DOMAIN`: a domain verified in that SES account (SES › Identities). Emails come from
   `no-reply@<it>` and, for a partner's merchants, `no-reply@<partner label>.<it>`.
3. In the sandbox, SES delivers only to **verified recipients**: add your own address under SES ›
   Identities › *Create identity* › Email address and click the link it sends.
4. Restart `pnpm dev`. The outbox job runs every minute: invite yourself from the admin
   console's Staff page and the email arrives within a minute. A refusal is logged in the
   terminal as `email_refused` with SES's reason, e.g. `MessageRejected` for an unverified
   recipient.

Store owner invitations stay in the outbox until merchant sign-in exists.

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
