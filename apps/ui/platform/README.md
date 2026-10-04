# platform

The partner console for Partner users: a static SPA on Cloudflare Pages at
`platform.dripfunnel.com`, calling the Platform API at `/api`. DripFunnel staff use
`apps/ui/admin` instead. Guide: [docs/ui/platform/](../../../docs/ui/platform/README.md); what
to build first: [FIRST-RELEASE.md](../../../docs/ui/platform/FIRST-RELEASE.md).

```bash
pnpm --filter ./apps/ui/platform dev   # http://localhost:5174, /api proxied to the local Worker
```

**Wired to the Platform API**: sign-in, 2-factor, accepting an invitation, sign-out, `me` and the
session guard, the partner-state banners, the nav badges, the header search and the setup
checklist with Submit (#164); Plans and Branding, with brand-file uploads (#165); the Dashboard,
Stores, Store detail with its actions, Create store and the export (#166); Domains, Activity log
and Settings (#203); Reports (#194), Support (#196) and Billing (#204, on #201's API). **No screen
reads a fixture any more.** Settings › Payout and payment still says the provider isn't switched
on: showing what is on file and adding a bank account or card need Stripe's publishable key and
its hosted fields (THIRD-PARTY-ACCESS §2.7). Against the local seed, `pnpm seed` prints an
invitation link to accept (set a password there, then sign in), and
`pnpm --filter ./apps/api session --partner <email>` prints a session cookie for any active
partner user.

## The shell

`src/routes/_app.tsx` is the shell every signed-in screen sits in (`src/features/shell/`, built
on #111): the header, the strips under it, the side bar, and the phone drawer. It reads `me`
first: nobody signed in goes to `/sign-in?next=` and comes back after. Its loader then reads
`partnerState` and `navBadges` (`src/api/partnerState.ts`, `navBadges.ts`). When the API
doesn't answer, the shell shows the load error with Try again (`ShellError`).

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
  then `PartnerBanners`, worded here from `partnerState`'s facts (FIRST-RELEASE §2.3): the
  Draft, Awaiting approval and Sent back strip, Paused with DripFunnel's reason, Offboarding,
  the hosts that stopped pointing at DripFunnel, and a staff setup session. The contract,
  store-limit, payout and card banners wait for facts the API doesn't send yet.
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
`?near=yes`), to a store's page and its tab (`/stores/<id>?tab=`), to Billing or to Reports. The date range lives in `?range=` (`month`,
`last`, `q`) and applies to every card. `dashboard(range)` supplies every comparison and
conversion as words; the screen formats and links and computes nothing. States:
`?state=loading`, `empty`, `error`, `stale`, `offline`; `?view=fresh` (a brand-new Live partner's
zeros) and `?view=stale` (the answer marked old) transform the real answer.

## Stores

`/stores` (`src/features/stores/`, #115; FIRST-RELEASE.md §6.1) is the partner's merchants at
account level: name and code, owner, plan (with "84% of products" under it when the API says a
limit is near), status (Trial · Active · Past due · Suspended · Cancelled, each a word, colour and
icon with the API's line under it), sales last month in the store's currency, storefront, domain
and created. Filters `?status=`, `?plan=`, `?created=` (`month`, `30d`, `90d`), `?storefront=`,
`?near=yes` and search `?q=` live in the URL and show as removable chips with Clear all. The
list pages by cursor on the API (`stores(filter, after, before)`, §16): **"Show 25 more"** asks for
the page after the last row's cursor and appends it in place, as the prototype does; the URL
carries no cursor, no page number and no total. Rows open the store's page. A partner that is not Live sees `NotLive` (`src/features/shell/`) pointing at the
checklist. States: `?state=loading`, `empty`, `error`, `readonly`, `denied`.

`/stores/new` (FIRST-RELEASE.md §6.2) creates a merchant: store name, owner's name and email,
country, plan (Live plans priced in the country's currency, from `createStoreForm`) and trial
(starting from the plan's own), with the price line and "The owner gets an invitation to set their own password."
Submitting shows **Setting up {store}** with the signup job's steps (SAAS.md §5) polled every
half second, then "Ready in …" with Open the store and Create another. Whether the caller may
create is the API's answer: Owner and Admin may; Finance, Support and Read-only see the button
disabled with the reason, and so does a partner that is not Live. The list primitives
(`ListHeader`, `SearchField`, `FilterSelect`, `ClickableRow`, `list.css`), the URL-search
helpers and cursor paging come from `@dripfunnel/shared`. `src/api/stores.ts` is the only
place this app talks to the API about stores. It reads the API's keys (`ai_prompts`, `past_due`,
`month`) as the console's, and leaves empty what the API doesn't send yet: last month's sales
and orders, invoices, the status history and support sessions.

**Export accounts (CSV)** (#134) is a job (§16): the header button starts `exportStores(filter)`
for everything the current filter matches, the shared `ExportWatcher` in the shell follows it on
any screen and says when it is ready, and the status line under the button offers the download
until the link expires. The file carries the account columns only; "Orders, customers and
products are never included." Every role may export (ACCESS.md §5.3 `exports`).

**Billing status** (#134; §6.1, §11.4) appears as a column only when the API says the partner
bills its merchants itself (`billingMode: own`): Active · Past due · Suspended, set inline by
Owner, Admin and Finance; the other roles see it disabled with the reason once above the table.
A cancelled store has none.

## Store detail

`/stores/<id>` (`src/features/stores/StoreDetail*.tsx` and `tabs/`, #116; FIRST-RELEASE.md §6.3,
§6.4) is one merchant's account as its partner sees it: the header (initials, "Store · {product}",
name, status with the API's line, code, the live link, **Actions ▾**) and eight tabs held in
`?tab=`: Overview (the account-level sentence, Account, Contacts, Plan and status history), Plan
and limits (a bar per limit from the API's percent, overrides with their reason), Billing (the
subscription as the API states it, who charges, invoices; a card is its last four digits only),
Storefront (read-only), Domains (status, the CNAME record with Copy, Re-check now), Setup (the
five signup steps), Support (the merchant's consent, its people and past sessions, read-only:
sessions start from Support) and Activity (the API's action codes, worded here; an unknown one
shows as its code). A suspended or past-due store carries a notice under the tabs, worded here
from the API's state.

**Actions** go through the shared `ConfirmDialog`, each stating its consequence first: Change
plan (the plan and when, from the API's plans and proration), Extend trial, Add a limit
override, Suspend (reason shown to the owner, the store name typed), Restore (reason), Resend
owner invitation, and Retry this step on the Setup tab. Which actions a store's state offers,
and who may take them, is the API's answer (`store(id).actions`, codes from §6.4): Owner and
Admin take them all, Finance only Extend trial, Support and Read-only none; a refused action
stays in place, disabled with the reason and who can. States: `?state=loading`, `error`,
`readonly`, `denied`, `confirm` (opens the first dialog the caller may use).

## Plans

`/plans` (`src/features/plans/`, #117; FIRST-RELEASE.md §7) is the partner's catalogue: name and
description, monthly and yearly price per currency with "DripFunnel's fee … / store / month"
under them, trial, stores (a link to the filtered list), status (Draft · Live · Retired), and
**New plan** for Owners and Admins. `/plans/<id>` (`new` for an empty one) is the editor, laid
out as design.md §7 says: cards on the left (name, description and trial; prices; what's
included), a sticky summary on the right (status, stores on it, Make live, Retire plan), and a
save bar that appears only when the draft differs from the saved plan. Beside each price the
fee and margin arrive from the API's `quotePlanPrices` as `Money` ("You keep $31.00 of $49.00", or in red
"Below DripFunnel's fee: you'd lose $3.00 per store"), re-quoted as prices are typed. The
entitlement matrix has the three kinds of SAAS.md §6.1 and shows DripFunnel's ceiling on every
row; a value above it is marked "Can't be more than 20,000." and Save is disabled with "Fix the
highlighted rows first." The API refuses it too (`ABOVE_CEILING`, naming the row); nothing is
clamped, and a row DripFunnel sets no ceiling for says so. Saving a plan stores are on asks who gets the change (new signups only, or everyone
at renewal); retiring hides the plan from signup and asks whether its stores keep it or move to
another plan on a date; retiring the last Live plan is refused (`LAST_LIVE_PLAN`). Owner and
Admin edit everything, Finance prices only (the other fields are disabled with the reason),
Support and Read-only view, each from the API's `create`, `edit` and `price` blocks. States:
`?state=loading`, `empty`, `error`, `readonly`, `denied` on the list; `loading`, `error`,
`readonly`, `denied`, `confirm` on the editor. `denied` can't make the API refuse: to see a role's
refusals, sign in as that role (`pnpm --filter ./apps/api session --partner <email>`).

Not here: **Compare plans** and **Defaults for new stores** (§7.4, §7.5, the next batch) and
promotions (SAAS §14).

## Branding

`/branding` (`src/features/branding/`, #118; FIRST-RELEASE.md §8) white-labels the merchant portal
in two tabs held in `?tab=`: **Look** (product name, primary and accent colours as a picker and
hex, the **Contrast check** with the API's ratios and its fix when a pair fails, font, corners,
sign-in background, the four files with Replace) and **Words** (support email and URL, help
centre, terms, privacy, the data-processing agreement with "Needed before DripFunnel can approve
you.", the Impressum where the law requires it, and "Powered by DripFunnel" on, off, or kept on
by the contract). Beside the form, **Preview · merchant portal** renders a sample sign-in card
and a portal header in the partner's look, at desktop or phone, light or dark, inside a frame
that says "In your brand. The console itself doesn't change." The preview's colours are its own
`--pv-*` variables on the frame; the console's `--df-*` tokens are never touched (README §4). Any
change shows "Unpublished changes. Merchants still see the published version. This affects 84
stores." with Discard and **Publish…**, which states the consequence first through
`ConfirmDialog`. Replace uploads the file at once (`POST /api/uploads/brand-file?kind=`, #219)
and puts the key it gets back in the draft; it shows only once published. Contrast is the
server's check: publishing refuses a failing pair
(`CONTRAST_FAILS`, with the fix), a "Powered by" choice the contract keeps on
(`POWERED_BY_FIXED_BY_CONTRACT`) and a missing Impressum where required (`IMPRESSUM_REQUIRED`);
the screen marks the same (the contrast panel, the Impressum field) and never clamps or fixes a colour. Owner and Admin edit; others view
with the controls disabled and the reason. States: `?state=loading`, `error`, `readonly`,
`denied`, `confirm`. Kaufladen's fixed "Powered by" and required Impressum come from the API:
sign in as its Owner (`jonas@kaufladen.example`) rather than switching `?partner=`.

Not here: email templates (§8.3), history, rollback and scheduling (§8.4), the Sign up, Products
and Settings sample screens of §8.1 (the card asks for the sign-in card and the header), and the
preview of the real portal screens, which arrives when `apps/ui/store` has them. The four brand
fonts the picker offers are loaded for the preview alone (designs/design.md §6).

## Onboarding

`/dashboard` is the setup checklist until the partner is Live (`src/features/onboarding/`, #113;
FIRST-RELEASE.md §4): the Platform API's `onboarding`, ten items with done · in progress · to do,
the API's detail (or the item's own hint), who completed each and the screen it links to; Run
test signup, disabled with its reason until its API exists; and Submit for approval as the
eleventh step, disabled with the API's verdict (`canSubmit`) or with the go-live checks it says
still fail. Payment method and payout details are the partner's own: locked
with "{partner} enters this itself" in a staff setup session, "Your turn" to the Owner. Awaiting
approval shows what happens next; Sent back shows DripFunnel's reason with the fix linked and
Submit again; Live shows a one-time card, then the Dashboard (#114).

`submitForApproval` answers `GO_LIVE_CHECK_FAILED` (naming the check), `ALREADY_SUBMITTED`,
`ALREADY_APPROVED` or, from the access layer, `FORBIDDEN`, which reads as the Owners-and-Admins
refusal. Harness: `?partner=draft|awaiting|sentback|live|paused|offboarding` (the shell's),
`?setup=dripfunnel` for the Owner's welcome card, `?state=setup` for the staff member's own
view (the setup-session bar), and `?moment=live` for the Live card. The welcome card and the
Live card stay harness-only: the API says neither whether this is the Owner's first sign-in
after staff set up nor whether Live is new.

## Signed-out screens

`/sign-in` (`src/features/auth/`, #112) is the front door of FIRST-RELEASE.md §3: work email
and password, then the 2-factor code, then `next` (same-origin only, `safeNext` in
`src/api/auth.ts`); forgot password is a step of the same card and answers the same way whether
or not the email exists. There is no sign-up and no Google button anywhere.

`src/api/auth.ts` calls the Platform API's `/api/auth/*` routes; each refusal is a stable code:
`INVALID_CREDENTIALS` (one message for an unknown email and a wrong password), `WRONG_CODE`
(with the tries left), `CODE_EXPIRED`, `LOCKED` (with its minutes), `RATE_LIMITED`, and
`NOT_CONNECTED` for anything the API never promised or no answer at all. A user whose partner
requires 2-factor and who has none enrols before reaching the console (the API's `enrol` step).
Sign out posts a form to `/api/auth/sign-out`, which ends the session and redirects. States:
`?state=wrong`, `code`, `wrongCode`, `expiredCode`, `locked`, `enrol`, `forgot`, `sent`,
`expired`, `notConnected`, `rateLimited`; `?outcome=expired` is the Worker's real result and is
read in every build.

`/accept-invite?token=` (#128) is the invitation side: the partner, role and invited email, a
name and a 10-character password, then 2-factor as step 2 of 2, required when the partner's
Owner requires it and otherwise skippable. The route loader looks the token up, so a bad link
is known before anything renders; the 2-factor step asks the API for a secret and shows it as a
text key (the QR code is still a placeholder). `?state=` substitutes the answer instead:
`expired`, `used`, `replaced`, `invalid`, `member` (invited by the Owner), `required` (2-factor
required), and `twoFactor` for step 2. Codes: `INVITATION_EXPIRED`, `INVITATION_USED`,
`INVITATION_REPLACED`, `INVITATION_INVALID`, `NAME_REQUIRED`, `WEAK_PASSWORD`,
`SECOND_FACTOR_REQUIRED`.

## Staff sessions

A staff impersonation or setup session (ACCESS.md §8.1, §8.2) arrives at
`/impersonate/enter?token=…` and shows the bar from `@dripfunnel/shared/ui` above every page.
Without the admin console, `?state=` shows `impersonating`, `setup`, `notice`, `noticeSetup`,
`ended`, `expired` and `invalid`. What a session can't change is listed, turned off with the
reason, under Settings.
The bar's Back link goes to the admin console on its dev port under `vite dev`; a build
uses `VITE_ADMIN_URL` (https only, e.g. a feature environment's console) or
`https://admin.dripfunnel.com`.
