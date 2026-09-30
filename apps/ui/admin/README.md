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
- **Environment**: `admin.dripfunnel.com` shows Production; every other host
  (`admin-dev.dripfunnel.com`, feature environments, localhost) shows Staging.
- **Widths**: at 1024px and below the side bar is a 64px icon rail; below 640px it becomes a
  drawer opened from the menu button.

## Dashboard

`/dashboard` (`src/features/dashboard/`) shows the five cards of FIRST-RELEASE.md §3, from
`src/api/dashboard.ts` on fixtures until the Admin API's `dashboard(partnerId)` exists. Every
number links to the list it counts with the filter in the URL; the partner filter is
`?partner=`. Its states: `?state=loading`, `empty`, `error`, `stale` and `offline`.

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

The state kit lives in `src/features/common/`: `EmptyState`, `LoadingState`, `ErrorState`,
`PermissionDenied`, `ReadOnlyNotice` and `ConfirmDialog`. Every word comes in as a prop from
`src/messages/`.

Any screen can be forced into one state without an API by adding `?state=` to its address
(`empty`, `loading`, `error`, `denied`, `readonly`, `confirm`). The screen calls
`useScreenState([...])` with the states it offers and lists them in its header comment; an
unknown or unoffered value is ignored.

`/states` shows every state and the dialog in one place.

The harness (both `?state=` and `/states`) is on under `vite dev`, and in a build only when
`VITE_STATE_HARNESS=1` is set at build time. Production never sets it, so there `?state=` is
ignored and `/states` shows the router's "Not Found" page (Pages still answers 200, as it
does for every SPA path).
