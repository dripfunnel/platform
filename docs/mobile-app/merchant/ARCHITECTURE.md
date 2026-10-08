# mobile-app/merchant: code architecture

How the code of `apps/ui/mobile-app/merchant` is laid out and how it talks to the platform.
The framework decision is [REACT-NATIVE.md](REACT-NATIVE.md); the look is [DESIGN.md](DESIGN.md);
builds and stores are [BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: proposed, not built.** The app folder doesn't exist yet. Rows marked *(proposed)*
await a yes.

Last updated: 2026-10-08.

---

## 1. Rules

1. **Don't change the API without permission.** The app works against the Store API as it is:
   `apps/api` (schema, resolvers, routes, migrations) is never changed for the app without the
   user's explicit permission. When a screen needs something the API doesn't offer, stop and
   ask, with the smallest option first (AGENTS.md "Working with the user" rule 6). Two API
   changes are already agreed, and each is still built on its own card:
   - bearer-token sessions (REACT-NATIVE.md §5);
   - in-app purchase notifications (FIRST-RELEASE.md §3).
2. **The API decides, the app displays** (ui/README.md §3). Prices, totals, tax, stock,
   permissions and plan limits come from the Store API. Hiding a control is a courtesy, never
   access control.
3. **Nothing per partner in code.** Everything that differs per partner comes from its
   configuration entry or the brand query (BUILDS-AND-STORE-ACCOUNTS.md §2).
4. **No secrets in the app or the repo.** The session token lives only in the phone's secure
   storage, and is never logged or shown. Signing credentials and store keys live in EAS
   (BUILDS-AND-STORE-ACCOUNTS.md §2).
5. **The SPA conventions hold** unless this document says otherwise (ui/README.md §2–§4): text
   from `messages/`, formatting through `@dripfunnel/shared/format`, errors handled by code,
   named exports, one component per file, and every screen's empty, loading, error,
   permission-denied and read-only states.

---

## 2. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Expo Router** for navigation *(proposed)* | React Navigation configured by hand | Expo's default. File routes like the SPAs' TanStack Router, so screens and URLs (deep links) line up with the web portal. |
| **The SPAs' folder pattern**: thin routes, `features/<area>/`, `api/<area>.ts`, `messages/`, `brand/` *(proposed)* | A mobile-specific layout | A developer moves between `apps/ui/store` and the app without relearning. Code moves to `apps/ui/shared/` the moment both use it. |
| **No state library** at first: screens call `api/` functions, as the SPAs do *(proposed)* | Redux, Zustand or React Query from day one | No dependency without a stated need (AGENTS.md "Dependencies"). Added when the offline queue (§5) or caching needs it. |
| **Theme tokens as a TypeScript object**, filled from DripFunnel's values and overridden by the brand query *(proposed)* | Reading `shared/ui/tokens.css` | React Native has no CSS variables. The values match the `--df-*` tokens. They move to `shared/` only if a web app needs them in TypeScript too. |
| **Jest with the `jest-expo` preset** for component tests; logic tests can stay on Vitest *(proposed)* | Vitest for everything | React Native components need its Babel transform and native mocks, which `jest-expo` provides. The gates stay `typecheck`, `lint`, `test`. |

---

## 3. Folder structure

`pnpm-workspace.yaml` matches `apps/ui/*`, which doesn't reach two levels down. The pull
request that sets the app up adds `apps/ui/mobile-app/*` to it.

```
apps/ui/mobile-app/merchant/
  app.config.ts             reads and validates the partner's env file (CONFIGURATION.md)
  partners/<partner>.env    one per partner: public build-time values (CONFIGURATION.md §2)
  partners/<partner>/       that partner's icon, splash and listing text
  .env.example              every variable with dummy values
  eas.json                  one build profile per partner
  src/
    app/                    Expo Router file routes; each renders one feature screen
      _layout.tsx           root: polyfills, brand, session; then (auth) or (tabs)
      (auth)/               signed out: sign-in, 2-factor, invitation, password reset
      (tabs)/               signed in: the tab bar (DESIGN.md §2)
        home.tsx  orders/  catalogue/  offers/  more/
    features/<area>/        screens, private components and hooks per area
    api/<area>.ts           this app's GraphQL operations, typed from apps/api/schema/
    session/                the bearer token in secure storage, acting store and supplier
    brand/                  loads the partner's look and turns it into the theme
    theme/                  tokens and the theme provider
    intl/                   the FormatJS polyfills, loaded first (REACT-NATIVE.md §6)
    nav.ts                  tabs and More items as data, per role
    messages/               en.json (+ other locales)
  package.json  tsconfig.json  README.md
```

---

## 4. Startup

1. Load the FormatJS polyfills (`src/intl/`), before anything formats.
2. Read the partner's portal domain from the build configuration (`expo-constants`).
3. Call the Store API's public brand query on that domain, and build the theme from it. Show
   the splash screen until it answers. If it fails, use the last look saved on the device,
   else DripFunnel's defaults.
4. Read the session token from secure storage. If there is none, or the API says it has
   expired, go to sign-in.
5. Load the person's stores (`myStores`): one store opens directly; several show the chooser.

---

## 5. Talking to the API

- **One client**: `createApiClient` from `@dripfunnel/shared/graphql`, with
  `endpoint: https://<portal domain>/api/`. Its `headers` adds `Authorization: Bearer <token>`,
  plus `X-Store` and `X-Supplier` (ACCESS.md §4).
- **`api/` is the only place that writes GraphQL**, with operations named for what they do.
  Screens call these functions, never `fetch`.
- **Errors by code** (`UNAUTHENTICATED`, `FORBIDDEN`, `PLAN_LIMIT_REACHED`, `NOT_CONNECTED`…),
  each mapped to a state from DESIGN.md §4.
- **Offline**: the prototype keeps changes on the device and saves them when the phone is back
  online (DESIGN.md §4). How that queue works, and which writes may wait in it, is decided
  before it's built. Writes must be safe to retry (AGENTS.md "Reliability").
