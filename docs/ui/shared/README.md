# ui/shared: code more than one SPA uses

`apps/ui/shared`, the private workspace package `@dripfunnel/shared`. Browser-only
TypeScript source, consumed directly by the SPAs; there is no build step.

Last updated: 2026-10-02 (#134).

---

## 1. What is in it

| Export | Holds | Today |
|---|---|---|
| `@dripfunnel/shared/ui` | Components, the screen-state kit and its `?state=` harness (#110), the console chrome both consoles draw (#111), the list primitives both consoles' lists use (#115), the detail-page pieces both consoles' detail pages use (#116), the staff-session pieces both portals use (#46), and the activity kit both consoles' Activity logs use (moved from the admin console on #192) | `Button`; `EmptyState`, `LoadingState`, `ErrorState`, `PermissionDenied`, `ReadOnlyNotice`, `ConfirmDialog`, `StateView` (with `ConfirmDemo`), `screenStates`, `useScreenState`, `useAnnouncement`; `SideNav`, `NavDrawer`, `UserMenu`, `Strip`, `Icon`, `initials`, `isBackdropClick`, `useTheme`, `usePhone` and `isPhone` (the shell's phone breakpoint: the admin console's and the merchant portal's Products, moved from the admin console on #298); `StatusPill`, `ListHeader`, `SearchField`, `FilterSelect`, `ClickableRow`; `DetailTabs`, `MoreActions`, `ActionControl`, `Tile`, `InfoNote`, `Toast`; `ExportWatcher`, `ExportJobStatus`, `exportJob`, `startExport`, `useExportJob`, `exportCheck`; `environmentFor`, `EnvironmentBanner`; `isHarnessEnabled`, `parseScreenState`; `ImpBanner`, `SessionNotice`, `SessionEndCard`, `StaffSessionLayer`, `PortalSessionRoot`, `HandoffScreen` (with `handoffSearch`), `SessionControls`, `adminConsoleUrlFor`, `blockedFor`, `staffSessionCopy`, `usePolling`; `createPortalSession` (the fixture for the `?state=` harness, and the portal's own API where it has one, #243); `PersonFinder` (the person typeahead, each app wording its options), `ActivityFact` and `activityResultLook`; `reserveTab` (a new tab opened on the click, before the API answers: the admin's impersonation and the partner's support sessions, #196) |
| `@dripfunnel/shared/ui/tokens.css` | Design tokens as CSS variables (`--df-*`), light and dark | colour, radius, spacing, font |
| `@dripfunnel/shared/ui/states.css` | The kit's stylesheet, for a screen that uses its classes (`df-button`, `df-field`, `df-dialog`, `df-visually-hidden`) without rendering a kit component | loaded by every kit component itself |
| `@dripfunnel/shared/ui/shell.css` | The console chrome's stylesheet (header, banners, side bar, drawer, user menu, page title), for an app's own shell composition | loaded by every shell component itself |
| `@dripfunnel/shared/ui/list.css` | The list stylesheet: the `.df-list` page, its header, toolbar, filters, search, table, name cells and pager, for a list screen's own markup | loaded by every list primitive itself |
| `@dripfunnel/shared/ui/activity.css` | The activity kit's stylesheet: the person finder and its options, and an entry's facts | loaded by the kit's components |
| `@dripfunnel/shared/ui/detail.css` | The detail-page stylesheet: detail header, breadcrumb, meta, actions, menu, tabs, panels, facts, lists, info note and toast, for a detail screen's own markup | loaded by every detail piece itself |
| `@dripfunnel/shared/graphql` | The client for `/api`: same-origin cookie, timeout, errors as `ApiError` with the API's code and, where the API gives them, its `details` (#298); every answer decoded with a zod schema, a mutation's `{ ok, code }` outcome turned into an `ApiError` (moved here from the admin console when the partner console needed them, #164); the cursor page shape every list query answers with (#19) and the paging a fixture does over a sorted list; an export job's answer read into one download link (moved from the partner console when the merchant portal's exports needed it, #302) | `createApiClient`, `ApiError`, `typedQuery`, `outcome`, `isApiError`; `PageInfo`, `PageRequest`, `pageByCursor`; `ExportJob`, `ExportState`, `exportJobSchema`, `exportJobFields`, `readExportJob` |
| `@dripfunnel/shared/auth` | The `/api/auth/*` transport: same-origin JSON POST with a timeout, a refusal kept only when its code is one the app's routes promise (else `NOT_CONNECTED`), and the other tabs told after a route that changes who is signed in (moved here from the partner console when the merchant portal needed it, #292) | `createAuthClient`, `AuthRefusal`, `isRefusal`, `authTimeoutMs` |
| `@dripfunnel/shared/search` | zod helpers for a route's URL search (#115): a value that doesn't fit is dropped, never a failed page | `optionalParam`, `searchParam`, `idParam` |
| `@dripfunnel/shared/format` | Money, dates, numbers and addresses through `Intl` | `looksLikeEmail` (the loose email shape both consoles' invitations check, #193), `ticketError` (a pasted ticket link is https or nothing, both consoles' session starts, #196), `formatMoney` (integer minor units + currency), `minorOf`, `moneyText` and `moneyDigits` (a price as typed into a form and back, by the currency's own decimals: the partner console's plans and the merchant portal's product editor), `formatDateTime` (always naming its time zone), `formatDuration`, `formatNumber`, `pluralForm` (the locale's plural rules over an app's `one`/`other` forms), `csv`, `csvCell` and `csvLink` (a CSV that no spreadsheet runs as a formula, and its download link) |

```
apps/ui/shared/
  ui/          components, the state kit (+ states.css), the console chrome (+ shell.css), the list primitives (+ list.css), the detail pieces (+ detail.css), tokens.css, index.ts
  graphql/     client.ts, typed.ts, pageInfo.ts, pageByCursor.ts (+ .test.ts), index.ts
  auth/        index.ts (+ .test.ts)
  search/      searchParams.ts, searchMaxLength.ts, index.ts
  format/      money.ts, dateTime.ts, duration.ts, number.ts, plural.ts (each + .test.ts), index.ts
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
  keeps the Appearance choice. Each app keeps its own `nav.ts`, header and `AppShell`. The
  merchant portal (#291) adds a row's `group` (the menu's headings) and `note` ("7 days left"),
  the store menu's icons, and `Strip` (`strip.css`), the one-line banner under the header that
  moved from the partner console once the portal's banners became its second user.
- **List primitives** (#115, moved for the partner console's Stores list, the admin console's
  lists' second user): `ListHeader` (title, lede and an action, with an eyebrow where a console draws one), `SearchField` (debounced,
  with an optional validator for text the URL would drop), `FilterSelect` (the label inside
  the control, tinted when a value is chosen) and `ClickableRow` (a table row that hands a plain click to its title link). `list.css`
  holds their styles. The zod helpers for URL searches are their own entry, `@dripfunnel/shared/search`,
  so an app without a list never bundles zod; `PageInfo` is the API's, in `graphql`. The admin
  console's `Pager` (Previous and Next) stays there: the partner console's lists end in "Show 25
  more" (ui/platform/FIRST-RELEASE.md §16).
- **Detail pieces** (#116, the partner console's Store detail being the admin console's detail
  pages' second user): `DetailTabs` (links, not an ARIA tab list: each tab is its own address),
  `MoreActions` (the "Actions ▾" disclosure, its label a prop), `ActionControl` (a button when
  allowed, `PermissionDenied` with the reason when refused), `Tile` (a record's initials standing
  in for its logo), `InfoNote` (a read-only fact in the info palette) and `Toast` (bottom centre,
  one line, 4.2 s). `detail.css` holds the detail header, meta, tabs, panels and their styles.
  `ConfirmDialog` takes `choices`, a list of picks, since the store actions need two in one
  dialog (plan and when; limit and duration). It also takes `children`, fields the caller keeps (the admin
  Set contract dialog, #436), and `error`, which keeps the dialog open with what was entered
  after a refused confirm and says why.
- **Export jobs** (#134, the partner console's store export being the admin activity export's
  second user): `exportJob` holds the one running export outside any screen, `useExportJob`
  reads it, `startExport` puts the API's answer in it, `exportCheck` decides what one status
  answer means, `ExportJobStatus` is the line under an Export button in the app's words, and
  `ExportWatcher`, mounted in a shell with the app's status query and its "ready" words, follows
  the job on any screen.
  The `ExportJob` shape is the API's, in `graphql`; `csv` in `format` writes the file.
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
