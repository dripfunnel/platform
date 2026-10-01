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
  name as "Signed in for", the search box (disabled with a note until #115 wires it), Help,
  and the user menu with Appearance, My activity and Sign out. The side bar, drawer, user menu
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
`callerFor` in `src/api/me.ts` for a Read-only or Support caller, and `?partner=draft`,
`awaiting` or `sentback` shows the shell as a partner in that state sees it.

`/states` (`src/features/states/StateGallery.tsx`) shows every state and the dialog in one
place, with this console's words.

The harness (`?state=`, `?partner=` and `/states`) is on under `vite dev`, and in a build only
when `VITE_STATE_HARNESS=1` is set at build time. Production never sets it.

## Staff sessions

A staff impersonation or setup session (ACCESS.md §8.1, §8.2) arrives at
`/impersonate/enter?token=…` and shows the bar from `@dripfunnel/shared/ui` above every page.
Without the admin console, `?state=` shows `impersonating`, `setup`, `notice`, `noticeSetup`,
`ended`, `expired` and `invalid`. What a session can't change is listed, turned off with the
reason, under Settings.
The bar's Back link goes to the admin console on its dev port under `vite dev`; a build
uses `VITE_ADMIN_URL` (https only, e.g. a feature environment's console) or
`https://admin.dripfunnel.com`.
