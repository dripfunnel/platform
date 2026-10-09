# mobile-app/merchant: code architecture

How the code of `apps/ui/mobile-app/merchant` is laid out and how it talks to the platform.
The framework decision is [REACT-NATIVE.md](REACT-NATIVE.md); the look is [DESIGN.md](DESIGN.md);
builds and stores are [BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: proposed, not built.** The app folder doesn't exist yet. Rows marked *(proposed)*
await a yes.

Last updated: 2026-10-09 (#493: own client and formatting, no offline queue, no in-app purchase).

---

## 1. Rules

1. **Don't change the API without permission.** The app works against the Store API as it is:
   `apps/api` (schema, resolvers, routes, migrations) is never changed for the app without the
   user's explicit permission. When a screen needs something the API doesn't offer, stop and
   ask, with the smallest option first (AGENTS.md "Working with the user" rule 6). Every API
   change the app needs is listed in §6, and nothing else changes.
2. **The API decides, the app displays** (ui/README.md §3). Prices, totals, tax, stock,
   permissions and plan limits come from the Store API. Hiding a control is a courtesy, never
   access control.
3. **Nothing per partner in code.** Everything that differs per partner comes from its
   configuration entry or the brand query (BUILDS-AND-STORE-ACCOUNTS.md §2).
4. **No secrets in the app or the repo.** The session token lives only in the phone's secure
   storage, and is never logged or shown. Signing credentials and store keys live in EAS
   (BUILDS-AND-STORE-ACCOUNTS.md §2).
5. **The SPA conventions hold, without `@dripfunnel/shared`** (REACT-NATIVE.md §2), unless this
   document says otherwise (ui/README.md §2–§4): text from `messages/`, formatting through the
   app's own `src/format/`, errors handled by code,
   named exports, one component per file, and every screen's empty, loading, error,
   permission-denied and read-only states.

---

## 2. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Expo Router** for navigation *(proposed)* | React Navigation configured by hand | Expo's default. File routes like the SPAs' TanStack Router, so screens and URLs (deep links) line up with the web portal. |
| **The SPAs' folder pattern**: thin routes, `features/<area>/`, `api/<area>.ts`, `messages/`, `brand/` *(proposed)* | A mobile-specific layout | A developer moves between `apps/ui/store` and the app without relearning. The code itself is not shared (REACT-NATIVE.md §2). |
| **No state library** at first: screens call `api/` functions, as the SPAs do *(proposed)* | Redux, Zustand or React Query from day one | No dependency without a stated need (AGENTS.md "Dependencies"). Added when the offline queue (§5) or caching needs it. |
| **Theme tokens as a TypeScript object**, filled from DripFunnel's values and overridden by the brand query *(proposed)* | Reading `shared/ui/tokens.css` | React Native has no CSS variables. The values match the `--df-*` tokens. |
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
    graphql/                the app's own API client and types generated from apps/api/schema/ (§5)
    api/<area>.ts           this app's GraphQL operations, typed from apps/api/schema/
    format/                 the app's own money, date, number and plural formatting (REACT-NATIVE.md §6)
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

- **One client, the app's own** (`src/graphql/`, not `createApiClient`; REACT-NATIVE.md §2), at
  `https://<portal domain>/api/`. It sends `Authorization: Bearer <token>`, plus `X-Store` and
  `X-Supplier` (ACCESS.md §4).
- **`api/` is the only place that writes GraphQL**, with operations named for what they do.
  Screens call these functions, never `fetch`.
- **Errors by code** (`UNAUTHENTICATED`, `FORBIDDEN`, `PLAN_LIMIT_REACHED`, `NOT_CONNECTED`…),
  each mapped to a state from DESIGN.md §4.
- **Offline: no write queue in the first release** (decided 2026-10-09). The app shows the
  offline banner (DESIGN.md §4), keeps what it has already loaded on screen, and every write
  needs a connection. If a queue is added later, which writes may wait in it is decided first,
  and these rules hold for any design:
  - **Each queued write belongs to one session, store and supplier.** It is wiped, never
    replayed, on sign-out, on session expiry, and on a store or supplier switch. A write is
    never sent under a different session or acting store from the one it was made in.
  - **The server re-authorises every replayed write.** It is an ordinary API call with the
    current session and headers, checked again, so a permission removed in the meantime
    refuses it. The app shows the refusal; it doesn't retry it.
  - **Only writes the Store API already makes safe to retry may wait in the queue** (AGENTS.md
    "Reliability"). Any other write needs the phone online. The queue never needs an API change.
  - **The queue is covered by isolation tests when it's built**: wiped on sign-out, expiry and
    switch; never replayed across stores or suppliers; refused after a permission is removed.

---

## 6. API changes the app needs

The app uses the **Store API as it is** for every screen, plus the public brand query it
already has. These are the only API changes, each built on its own card with permission
(§1 rule 1). Nothing changes for the merchant portal, the partner console or the admin console.

| Change | What it touches | New endpoints, tables or migrations | When |
|---|---|---|---|
| **Bearer-token session** (ACCESS.md §4) | The routes that open a session (sign-in, 2-factor, invitation, reset) return the session in the body to a request with no `Origin` and no cookie. The session reader accepts `Authorization: Bearer` when no cookie is sent. | None: the same `user_session` row | Before any screen that calls the API |
| **App icon and splash uploads** (BUILDS-AND-STORE-ACCOUNTS.md §5) | An upload on the partner console's branding screen (Platform API), stored with `partner_branding` | A new field on `partner_branding`; likely a migration | Before a partner's first build |

Anything a screen needs beyond these is a question first, never code.
