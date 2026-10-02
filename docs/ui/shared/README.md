# ui/shared: code more than one SPA uses

`apps/ui/shared`, the private workspace package `@dripfunnel/shared`. Browser-only
TypeScript source, consumed directly by the SPAs; there is no build step.

Last updated: 2026-10-02 (#115).

---

## 1. What is in it

| Export | Holds | Today |
|---|---|---|
| `@dripfunnel/shared/ui` | Components, the screen-state kit and its `?state=` harness (#110), the console chrome both consoles draw (#111), the list primitives both consoles' lists use (#115), and the staff-session pieces both portals use (#46) | `Button`; `EmptyState`, `LoadingState`, `ErrorState`, `PermissionDenied`, `ReadOnlyNotice`, `ConfirmDialog`, `StateView` (with `ConfirmDemo`), `screenStates`, `useScreenState`, `useAnnouncement`; `SideNav`, `NavDrawer`, `UserMenu`, `Icon`, `initials`, `isBackdropClick`, `useTheme`; `StatusPill`, `ListHeader`, `SearchField`, `FilterSelect`, `Pager`, `ClickableRow`; `environmentFor`, `EnvironmentBanner`; `isHarnessEnabled`, `parseScreenState`; `ImpBanner`, `SessionNotice`, `SessionEndCard`, `StaffSessionLayer`, `PortalSessionRoot`, `HandoffScreen` (with `handoffSearch`), `SessionControls`, `adminConsoleUrlFor`, `blockedFor`, `staffSessionCopy`, `usePolling`; `createPortalSession`, the portals' fixture until #68 |
| `@dripfunnel/shared/ui/tokens.css` | Design tokens as CSS variables (`--df-*`), light and dark | colour, radius, spacing, font |
| `@dripfunnel/shared/ui/states.css` | The kit's stylesheet, for a screen that uses its classes (`df-button`, `df-field`, `df-dialog`, `df-visually-hidden`) without rendering a kit component | loaded by every kit component itself |
| `@dripfunnel/shared/ui/shell.css` | The console chrome's stylesheet (header, banners, side bar, drawer, user menu, page title), for an app's own shell composition | loaded by every shell component itself |
| `@dripfunnel/shared/ui/list.css` | The list stylesheet: the `.df-list` page, its header, toolbar, filters, search, table, name cells and pager, for a list screen's own markup | loaded by every list primitive itself |
| `@dripfunnel/shared/graphql` | The client for `/api`: same-origin cookie, timeout, errors as `ApiError` with the API's code; the cursor page shape every list query answers with (#19) | `createApiClient`, `ApiError`; `PageInfo`, `PageRequest` |
| `@dripfunnel/shared/search` | zod helpers for a route's URL search (#115): a value that doesn't fit is dropped, never a failed page | `optionalParam`, `searchParam`, `idParam` |
| `@dripfunnel/shared/format` | Money, dates, numbers and addresses through `Intl` | `formatMoney` (integer minor units + currency), `formatDateTime` (always naming its time zone), `formatDuration`, `formatNumber` |

```
apps/ui/shared/
  ui/          components, the state kit (+ states.css), the console chrome (+ shell.css), the list primitives (+ list.css), tokens.css, index.ts
  graphql/     client.ts, pageInfo.ts, index.ts
  search/      searchParams.ts, searchMaxLength.ts, index.ts
  format/      money.ts, dateTime.ts, duration.ts, number.ts (each + .test.ts), index.ts
  package.json exports map; peer dependencies on react, @tanstack/react-router and zod
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
- **List primitives** (#115, moved for the partner console's Stores list, the admin console's
  lists' second user): `ListHeader` (eyebrow, title, lede and an action), `SearchField` (debounced,
  with an optional validator for text the URL would drop), `FilterSelect` (the label inside
  the control, tinted when a value is chosen), `Pager` (Previous and Next from a `PageInfo`'s
  cursors, with the words and the link as props: cursor paging with no total, decided on
  #19), and `ClickableRow` (a table row that hands a plain click to its title link). `list.css`
  holds their styles; each console keeps its detail-page styles until a second console draws
  a detail page. The zod helpers for URL searches are their own entry, `@dripfunnel/shared/search`,
  so an app without a list never bundles zod; `PageInfo` is the API's, in `graphql`.
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
