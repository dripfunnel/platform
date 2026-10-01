# ui/shared: code more than one SPA uses

`apps/ui/shared`, the private workspace package `@dripfunnel/shared`. Browser-only
TypeScript source, consumed directly by the SPAs; there is no build step.

Last updated: 2026-10-02 (#111).

---

## 1. What is in it

| Export | Holds | Today |
|---|---|---|
| `@dripfunnel/shared/ui` | Components, the screen-state kit and its `?state=` harness (#110), the console chrome both consoles draw (#111), and the staff-session pieces both portals use (#46) | `Button`; `EmptyState`, `LoadingState`, `ErrorState`, `PermissionDenied`, `ReadOnlyNotice`, `ConfirmDialog`, `StateView` (with `ConfirmDemo`), `screenStates`, `useScreenState`, `useAnnouncement`; `SideNav`, `NavDrawer`, `UserMenu`, `Icon`, `initials`, `isBackdropClick`, `useTheme`; `environmentFor`, `EnvironmentBanner`; `isHarnessEnabled`, `parseScreenState`; `ImpBanner`, `SessionNotice`, `SessionEndCard`, `StaffSessionLayer`, `PortalSessionRoot`, `HandoffScreen` (with `handoffSearch`), `SessionControls`, `adminConsoleUrlFor`, `blockedFor`, `staffSessionCopy`, `usePolling`; `createPortalSession`, the portals' fixture until #68 |
| `@dripfunnel/shared/ui/tokens.css` | Design tokens as CSS variables (`--df-*`), light and dark | colour, radius, spacing, font |
| `@dripfunnel/shared/ui/states.css` | The kit's stylesheet, for a screen that uses its classes (`df-button`, `df-field`, `df-dialog`, `df-visually-hidden`) without rendering a kit component | loaded by every kit component itself |
| `@dripfunnel/shared/ui/shell.css` | The console chrome's stylesheet (header, banners, side bar, drawer, user menu, page title), for an app's own shell composition | loaded by every shell component itself |
| `@dripfunnel/shared/graphql` | The client for `/api`: same-origin cookie, timeout, errors as `ApiError` with the API's code | `createApiClient`, `ApiError` |
| `@dripfunnel/shared/format` | Money, dates, numbers and addresses through `Intl` | `formatMoney` (integer minor units + currency), `formatDateTime` (always naming its time zone), `formatDuration`, `formatNumber` |

```
apps/ui/shared/
  ui/          components, the state kit (+ states.css), the console chrome (+ shell.css), tokens.css, index.ts
  graphql/     client.ts, index.ts
  format/      money.ts, dateTime.ts, duration.ts, number.ts (each + .test.ts), index.ts
  package.json exports map; peer dependencies on react and @tanstack/react-router
```

---

## 2. What belongs here

- **Only what a second app needs.** A component, hook or helper starts in the app that
  needs it. When a second app needs the same thing, move it here in that change and say so.
  Never add something "because another app might need it".
- **Nothing app-specific**: no Store, Platform or Admin API operations (those live in each
  app's `src/api/`), no app's messages, no navigation.
- **No imports from any app**, and nothing from `apps/api` (lint enforces both).
- **No server code, no secrets.**

---

## 3. How it is built

From [../../code/DESIGN.md](../../code/DESIGN.md) §5:

- **Tokens first**: colour, type, spacing, radius, elevation and motion as CSS variables.
  Components never hard-code a colour. The merchant portal overrides the brand tokens with
  the partner's look; the consoles use DripFunnel's.
- **Accessible by default**: WCAG 2.2 AA, keyboard and screen-reader support in every
  component, focus visible, reduced motion respected.
- **Composition over configuration**: small components that compose (`Field`, `Label`,
  `Input`, `Hint`, `Error`), not one component with forty props.
- **Every component has its states**: empty, loading (skeleton), error, disabled with a
  reason, read-only. The `?state=` helper that makes every designed state reachable without
  a backend lives here since the portals needed it for their session states (#46,
  ../README.md §6). The state kit itself (`EmptyState` … `ConfirmDialog`, `useScreenState`)
  moved here from the admin console on #110 for the partner console, its
  second user: decided 2026-10-01 when the PC batch was cut, so that #111 (the console's
  shell and `/states`) builds on the shared kit instead of moving it half-way through.
  `useScreenState(allowed, enabled)` takes the harness flag
  from the app, which computes it once with `isHarnessEnabled(import.meta.env)`. Each app
  keeps its own `/states` gallery page; the gallery's `StateView` and demo dialog moved here
  on #111 with words as props, once the partner console's gallery became their second user.
- **Console chrome** (#111, the partner console being the admin console's second user):
  `SideNav` draws rows the app has already worded (`NavRowView`: label, and a badge only when
  work is waiting, with its spoken label); `NavDrawer` is the phone's side bar; `UserMenu`
  takes the person, the words, the app's theme storage key and the app's own menu entries as
  a render function; `Icon` is one outline set for both consoles; `useTheme(storageKey)`
  keeps the Appearance choice. Each app keeps its own `nav.ts`, header and `AppShell`.
- **Environment**: `environmentFor(hostname)` names the four environments for both consoles
  (`prod` only on the two exact production hosts, `dev` on the `dev-*.dripfunnel.ai` hosts,
  `local` on localhost, everything else `feature`, so a look-alike is never production), and
  `EnvironmentBanner` draws the strip, red only for `prod`. The partner console uses both
  (#111); the admin console switches to them on #65.
- **Words are props**: every string comes from the calling app's messages.
- **Visual baseline**: `../../../../.design/settings-tabs.html` (PLATFORM-PROMPT §6).
- **Tests** beside the code (`money.test.ts`), especially for formatting across currencies
  and locales (zero- and three-decimal currencies).

`@dripfunnel/storefront-core` never imports from here: the published package carries its
own small helpers (../../code/ARCHITECTURE.md §1).
