# admin

The admin console for DripFunnel staff (DF Admin): a static SPA on Cloudflare Pages at
`admin.dripfunnel.com`, calling the Admin API at `/api`. It manages every partner and platform.
Guide: [docs/ui/admin/](../../../docs/ui/admin/README.md); design: [CONSOLE-DESIGN.md](../../../docs/ui/admin/CONSOLE-DESIGN.md).

```bash
pnpm --filter ./apps/ui/admin dev   # http://localhost:5175, /api proxied to the local Worker
```

## The shell

`src/routes/_app.tsx` is the shell every signed-in screen sits in (`src/features/shell/`):
the header, the side bar, the banners under the header, and the phone drawer. Its loader
reads the signed-in staff member and the nav badge counts from `src/api/me.ts` and
`src/api/navBadges.ts`, which are fixtures for now.

- **Navigation is data** in `src/nav.ts`: one row per screen, with the roles that may use it.
  A row a role can't use is absent, not disabled. Adding a screen means one route file under
  `src/routes/_app/`, one folder under `src/features/`, and one row in `nav.ts`.
- **Shared chrome**: the side bar, phone drawer, user menu, icon set, `initials` and
  `shell.css` come from `@dripfunnel/shared/ui` since #111, when the partner console became
  their second user. `navView.ts` turns this app's rows into what the shared side bar draws.
  `AppHeader`, `AppShell`, the search dialog (`search.css`) and the environment pieces stay
  here.
- **Environment**: `admin.dripfunnel.com` shows Production; every other host shows Staging,
  until #65 switches this app to the shared four-value `environmentFor` (`environment.css`
  holds the two modifiers it will remove).
- **Widths**: at 1024px and below the side bar is a 64px icon rail; below 640px it becomes a
  drawer opened from the menu button.

## Dashboard

`/dashboard` (`src/features/dashboard/`) shows the five cards of FIRST-RELEASE.md §3, from
`src/api/dashboard.ts` on fixtures until the Admin API's `dashboard(partnerId)` exists. Every
number links to the list it counts with the filter in the URL; the partner filter is
`?partner=`. Its states: `?state=loading`, `empty`, `error`, `stale` and `offline`.

## Partners

`/partners` (`src/features/partners/`) is the list of FIRST-RELEASE.md §4.1: filters
`?status=` and `?setup=`, search `?q=`, and cursor pages `?after=` / `?before=`, all in the URL.
The list primitives every list here is built from (`ListHeader`, `SearchField`,
`FilterSelect`, `Pager`, `ClickableRow`, the URL-search helpers and `list.css`) come from
`@dripfunnel/shared/ui` since #115, when the partner console's Stores list became their second
user; `src/features/common/detail.css` keeps the detail-page styles only this console draws.
`/partners/<id>` is the detail page with the seven tabs of §4.2 (`?tab=`) and the §4.3 actions
through `ConfirmDialog`. Both read `src/api/partners.ts`, the only place the app talks to the
API about partners, on fixtures until #33. Whether each action is allowed, and why not, comes
from `partner(id)`; no component works it out. States: the list takes `?state=loading`,
`empty`, `error`, `readonly` and `denied`; the detail takes `loading`, `error`, `readonly`,
`denied` and `confirm`. `readonly` and `denied` ask the fixture for a Read-only or Support caller.

## Impersonate

`/impersonate` (`src/features/impersonate/`) lists the users of FIRST-RELEASE.md §8;
`/impersonate/sessions` shows both kinds of staff session and `/impersonate/sessions/<id>` one
of them. One start flow (`StartSessionDialog`) serves Impersonate, a partner's Team tab, a
store's Users tab and a partner's setup entry. Everything goes through
`src/api/impersonation.ts`, on a server-shaped sample until #40. A started session opens the
store portal (port 5173) or the partner console (port 5174) in a new tab. States: Users takes
`?state=loading`, `empty`, `error`, `denied`, `nomatch`, `reauthFailed` and `reauthCancelled`;
Sessions takes `loading`, `empty`, `error` and `denied`.

## Sign-in

`/sign-in` (`src/features/sign-in/`) is the staff sign-in with Microsoft Entra ID, following
the prototype. It isn't wired to an API yet, so it steps through the prototype's flow
locally: the Microsoft button shows "Signing you in…", then the Authenticator request;
"use a code" and Verify lead to the dashboard; "Use another Microsoft account" goes back to
the start. Nothing checks who you are, so this walk-through runs only where the harness is
on (below); a production build's buttons do nothing until #13 adds the real redirect.
Force one state with `?state=` (`signing`, `approve`, `code`, `cancelled`, `denied`,
`unavailable`, `blocked`, `refused`, `expired`); without it the screen starts at the
Microsoft button. The environment banner shows here too.

The SPA needs no sign-in variables. The tenant ID, client ID and client secret belong to the
API Worker ([THIRD-PARTY-ACCESS.md §2.5](../../../docs/code/THIRD-PARTY-ACCESS.md)); never put
them in a `VITE_*` variable, which ends up in the public bundle.

## Screen states

The state kit (`EmptyState`, `LoadingState`, `ErrorState`, `PermissionDenied`,
`ReadOnlyNotice`, `ConfirmDialog`) comes from `@dripfunnel/shared/ui`; it moved there from
`src/features/common/` on #110 when the partner console became its second user. Every word
comes in as a prop from `src/messages/`. A screen that uses the kit's classes without a kit
component imports `@dripfunnel/shared/ui/states.css` itself.

Any screen can be forced into one state without an API by adding `?state=` to its address
(`empty`, `loading`, `error`, `denied`, `readonly`, `confirm`). The screen calls
`useScreenState([...], harnessEnabled)` with the states it offers and lists them in its
header comment; an unknown or unoffered value is ignored. `harnessEnabled` is this app's
flag, computed once in `src/harness.ts`.

`/states` (`src/features/common/StateGallery.tsx`, with `StateView` and `ConfirmDemo`) shows
every state and the dialog in one place; it stays in this app, as each console has its own.

The harness (both `?state=` and `/states`) is on under `vite dev`, and in a build only when
`VITE_STATE_HARNESS=1` is set at build time. Production never sets it, so there `?state=` is
ignored and `/states` shows the router's "Not Found" page (Pages still answers 200, as it
does for every SPA path).
