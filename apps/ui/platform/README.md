# platform

The partner console for Partner users: a static SPA on Cloudflare Pages at
`platform.dripfunnel.com`, calling the Platform API at `/api`. DripFunnel staff use
`apps/ui/admin` instead. Guide: [docs/ui/platform/](../../../docs/ui/platform/README.md); what
to build first: [FIRST-RELEASE.md](../../../docs/ui/platform/FIRST-RELEASE.md).

```bash
pnpm --filter ./apps/ui/platform dev   # http://localhost:5174, /api proxied to the local Worker
```

## The shell

`src/routes/_app.tsx` is the shell every signed-in screen sits in (`src/features/shell/`, built
on #111): the header, the strips under it, the side bar, and the phone drawer. Its loader reads
the signed-in partner user and the nav badge counts from `src/api/me.ts` and
`src/api/navBadges.ts`, which are fixtures until the Platform API's `me` arrives.

- **Navigation is data** in `src/nav.ts`: the ten rows of FIRST-RELEASE.md §2.1, with the roles
  that see each. A row a role can't use is absent, not disabled: Billing for Support, Support
  for Finance and Read-only. Adding a screen means one route file under `src/routes/_app/`,
  one folder under `src/features/`, and one row in `nav.ts`. Until a screen's card lands its
  route renders `ScreenPlaceholder`, so every row resolves.
- **The header** (FIRST-RELEASE §2.2) is DripFunnel's: the mark, "Partners", then the partner's
  name as "Signed in for", the search box over the partner's stores (`SearchPalette`, #115:
  a dialog opened by the button or ⌘K, matches as you type with owner email, domain and
  status, Enter for the whole list filtered by the text), Help, and the user menu with Appearance, My activity and Sign out. The side bar, drawer, user menu
  and icons come from `@dripfunnel/shared/ui`; `partner.css` holds only what this console
  alone draws.
- **Strips under the header**: the environment strip on every host but production (Dev,
  Feature, Local by hostname from the shared `environmentFor`; decided 2026-10-01 on #109),
  and the partner-state strip while the partner is Draft, Awaiting approval or Sent back
  (FIRST-RELEASE §2.3).
- **Widths**: at 1024px and below the side bar is a 64px icon rail; below 640px it becomes a
  drawer opened from the menu button.

## Screen states

The state kit (`EmptyState`, `LoadingState`, `ErrorState`, `PermissionDenied`,
`ReadOnlyNotice`, `ConfirmDialog`) comes from `@dripfunnel/shared/ui`; every word comes in as
a prop from `src/messages/`.

Any screen can be forced into one state without an API by adding `?state=` to its address
(`empty`, `loading`, `error`, `denied`, `readonly`, `confirm`). A screen calls
`useScreenState([...], harnessEnabled)` with the states it offers; `harnessEnabled` is this
app's flag, computed once in `src/harness.ts`. `?state=readonly` and `?state=denied` also ask
`callerFor` in `src/api/me.ts` for a Read-only or Support caller (the shell's loader applies it,
so the menu changes too), and `?partner=draft`,
`awaiting` or `sentback` shows the shell as a partner in that state sees it.

`/states` (`src/features/states/StateGallery.tsx`) shows every state and the dialog in one
place, with this console's words.

The harness (`?state=`, `?partner=` and `/states`) is on under `vite dev`, and in a build only
when `VITE_STATE_HARNESS=1` is set at build time. Production never sets it.

## Dashboard

Once the partner is Live, `/dashboard` (`src/features/dashboard/`, #114; FIRST-RELEASE.md §5)
draws six cards: Stores, Revenue, Needs attention, Signups, Usage and Top stores by sales. Every
number is a link to the Stores list with the filter in the URL (`?status=`, `?created=`,
`?near=yes`, `?store=`), to Billing or to Reports. The date range lives in `?range=` (`month`,
`last`, `q`) and applies to every card. The fixture in `src/api/dashboard.ts` supplies every
comparison and conversion as words; the screen formats and links and computes nothing. States:
`?state=loading`, `empty`, `error`, `stale`, `offline`; `?view=fresh` is a brand-new Live partner
and `?view=stale` numbers the API marks as old.

## Stores

`/stores` (`src/features/stores/`, #115; FIRST-RELEASE.md §6.1) is the partner's merchants at
account level: name and code, owner, plan (with "84% of products" under it when the API says a
limit is near), status (Trial · Active · Past due · Suspended · Cancelled, each a word, colour and
icon with the API's line under it), sales last month in the store's currency, storefront, domain
and created. Filters `?status=`, `?plan=`, `?created=` (`month`, `30d`, `90d`), `?storefront=`,
`?near=yes` and search `?q=` live in the URL and show as removable chips with Clear all. The
list pages by cursor on the API (`stores(filter, after, before)`, §16): **"Show 25 more"** asks for
the page after the last row's cursor and appends it in place, as the prototype does; the URL
carries no cursor, no page number and no total. Rows open the store, landing on this list with `?store=` until #116 adds
the detail page. A partner that is not Live sees `NotLive` (`src/features/shell/`) pointing at the
checklist. States: `?state=loading`, `empty`, `error`, `readonly`, `denied`.

`/stores/new` (FIRST-RELEASE.md §6.2) creates a merchant: store name, owner's name and email,
country, plan (Live plans priced in the country's currency, from the fixture until #117's plans)
and trial, with the price line and "The owner gets an invitation to set their own password."
Submitting shows **Setting up {store}** with the signup job's steps (SAAS.md §5) polled every
half second, then "Ready in …" with Open the store and Create another. Whether the caller may
create is the API's answer: Owner and Admin may; Finance, Support and Read-only see the button
disabled with the reason, and so does a partner that is not Live. The list primitives
(`ListHeader`, `SearchField`, `FilterSelect`, `ClickableRow`, `list.css`), the URL-search
helpers and cursor paging come from `@dripfunnel/shared`. `src/api/stores.ts` is the only
place this app talks to the API about stores, on the fixture in `storesSample.ts`.

Not here yet: **Export accounts (CSV)** and the **Billing status** column of own-billing mode
(§6.1, §11.4), both recorded on #115's follow-up.

## Onboarding

`/dashboard` is the setup checklist until the partner is Live (`src/features/onboarding/`, #113;
FIRST-RELEASE.md §4): the ten items of SAAS §3.2 with done · in progress · to do, who completed
each, a link to its screen (Settings and Domains are placeholders until their cards land), the
test signup button, and Submit for approval as the eleventh step, disabled with the reason until
the required items are done. Payment method and payout details are the partner's own: locked
with "{partner} enters this itself" in a staff setup session, "Your turn" to the Owner. Awaiting
approval shows what happens next; Sent back shows DripFunnel's reason with the fix linked and
Submit again; Live shows a one-time card, then the Dashboard (#114).

The fixture in `src/api/onboarding.ts` refuses a submit while a go-live check fails
(`GO_LIVE_CHECK_FAILED`, naming the check) and refuses Support, Finance and Read-only
(`OWNERS_AND_ADMINS_ONLY`). Harness: `?partner=draft|awaiting|sentback|live` (the shell's),
`?setup=dripfunnel` for a partner set up by staff (items "Done by DripFunnel", the Owner's
welcome card), `?state=setup` for the staff member's own view (the setup-session bar), and
`?moment=live` for the Live card.

## Signed-out screens

`/sign-in` (`src/features/auth/`, #112) is the front door of FIRST-RELEASE.md §3: work email
and password, then the 2-factor code, then `next` (same-origin only, `safeNext` in
`src/api/auth.ts`); forgot password is a step of the same card and answers the same way whether
or not the email exists. There is no sign-up and no Google button anywhere.

The fixture in `src/api/auth.ts` stands in for the Platform API's auth routes and refuses what
they will refuse, with the same message and the same timing for an unknown email and a wrong
password: `INVALID_CREDENTIALS`, `WRONG_CODE` (with the tries left), `CODE_EXPIRED`, `LOCKED`
(15 minutes after five wrong codes), `NOT_CONNECTED` when the harness is off. Under `vite dev`
sign in as `maya@northstar.com` / `northstar-partners` (2-factor: code `123456`; `000000` is an
expired code) or `alex@northstar.com` with the same password (no 2-factor). States:
`?state=wrong`, `code`, `wrongCode`, `expiredCode`, `locked`, `forgot`, `sent`, `expired`,
`notConnected`; `?outcome=expired` is the Worker's real result and is read in every build.

`/accept-invite?token=` (#128) is the invitation side: the partner, role and invited email, a
name and a 10-character password, then 2-factor as step 2 of 2, required when the partner's
Owner requires it and otherwise skippable. The route loader fetches the invitation, so a bad
link is known before anything renders. Fixture tokens, also reachable as `?state=`: `expired`,
`used`, `replaced`, `invalid`, `member` (invited by the Owner), `required` (2-factor required),
anything else the Owner's own invitation; `twoFactor` jumps to step 2. Codes:
`INVITATION_EXPIRED`, `INVITATION_USED`, `INVITATION_REPLACED`, `INVITATION_INVALID`,
`WEAK_PASSWORD`, `SECOND_FACTOR_REQUIRED`.

## Staff sessions

A staff impersonation or setup session (ACCESS.md §8.1, §8.2) arrives at
`/impersonate/enter?token=…` and shows the bar from `@dripfunnel/shared/ui` above every page.
Without the admin console, `?state=` shows `impersonating`, `setup`, `notice`, `noticeSetup`,
`ended`, `expired` and `invalid`. What a session can't change is listed, turned off with the
reason, under Settings.
The bar's Back link goes to the admin console on its dev port under `vite dev`; a build
uses `VITE_ADMIN_URL` (https only, e.g. a feature environment's console) or
`https://admin.dripfunnel.com`.
