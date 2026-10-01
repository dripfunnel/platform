# ui/shared: code more than one SPA uses

`apps/ui/shared`, the private workspace package `@dripfunnel/shared`. Browser-only
TypeScript source, consumed directly by the SPAs; there is no build step.

Last updated: 2026-10-01.

---

## 1. What is in it

| Export | Holds | Today |
|---|---|---|
| `@dripfunnel/shared/ui` | Components, the designed-states helper, and the staff-session pieces both portals use (#46) | `Button`; `isHarnessEnabled`, `parseScreenState`; `ImpBanner`, `SessionNotice`, `SessionEndCard`, `StaffSessionLayer`, `PortalSessionRoot`, `HandoffScreen` (with `handoffSearch`), `SessionControls`, `adminConsoleUrlFor`, `blockedFor`, `staffSessionCopy`, `usePolling`; `createPortalSession`, the portals' fixture until #68 |
| `@dripfunnel/shared/ui/tokens.css` | Design tokens as CSS variables (`--df-*`), light and dark | colour, radius, spacing, font |
| `@dripfunnel/shared/graphql` | The client for `/api`: same-origin cookie, timeout, errors as `ApiError` with the API's code | `createApiClient`, `ApiError` |
| `@dripfunnel/shared/format` | Money, dates, numbers and addresses through `Intl` | `formatMoney` (integer minor units + currency), `formatDateTime` (always naming its time zone), `formatDuration`, `formatNumber` |

```
apps/ui/shared/
  ui/          components, tokens.css, index.ts
  graphql/     client.ts, index.ts
  format/      money.ts, dateTime.ts, duration.ts, number.ts (each + .test.ts), index.ts
  package.json exports map; peer dependency on react
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
  ../README.md §6).
- **Words are props**: every string comes from the calling app's messages.
- **Visual baseline**: `../../../../.design/settings-tabs.html` (PLATFORM-PROMPT §6).
- **Tests** beside the code (`money.test.ts`), especially for formatting across currencies
  and locales (zero- and three-decimal currencies).

`@dripfunnel/storefront-core` never imports from here: the published package carries its
own small helpers (../../code/ARCHITECTURE.md §1).
