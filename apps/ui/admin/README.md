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
