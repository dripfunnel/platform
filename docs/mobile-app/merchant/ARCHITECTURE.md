# mobile-app/merchant: code architecture

How the code of `apps/ui/mobile-app/merchant` is laid out and how it talks to the platform.
The framework decision is [REACT-NATIVE.md](REACT-NATIVE.md); the look is [DESIGN.md](DESIGN.md);
builds and stores are [BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: the project is set up (#496), its foundations are built (#497) and so are getting in and My profile
(#498), the shell (#499) and Products (#500); the other screens are placeholders.**
`app.config.ts`, `partners/`, `eas.json`, the Expo Router skeleton under `src/app/`, and `src/graphql/`,
`src/intl/`, `src/format/`, `src/messages/`, `src/theme/`, `src/brand/`, `src/session/`, `src/features/auth/`,
`src/features/profile/`, `src/features/shell/`, `src/features/states/`, `src/features/products/` and `src/api/` (`brand`, `auth`, `profile`, `shell`, `products`, `inventory`,
`productStory`) exist (the placeholder screen in
`src/features/placeholder/` goes when the first real screen replaces it). Only `nav.ts` is still to build. Rows
marked *(proposed)* await a yes.

Last updated: 2026-10-13 (#500: Products, §3, §5). Before: 2026-10-13 (#498: the session and getting in, §4–§5). Before: 2026-10-13 (#497: the foundations, §4–§5). Before: 2026-10-12 (#496: the project is set up). Before: 2026-10-09 (#493: own client and formatting, no offline queue, no in-app purchase).

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
6. **A mobile card needs only the Store API card for its area, never the web screen card**
   (decided 2026-10-09). Where that Store API card is still open, the mobile card **Needs** it
   and is built on the real API, with no fixtures.

---

## 2. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Expo Router** for navigation *(proposed)* | React Navigation configured by hand | Expo's default. File routes like the SPAs' TanStack Router, so screens and URLs (deep links) line up with the web portal. |
| **The SPAs' folder pattern**: thin routes, `features/<area>/`, `api/<area>.ts`, `messages/`, `brand/` *(proposed)* | A mobile-specific layout | A developer moves between `apps/ui/store` and the app without relearning. The code itself is not shared (REACT-NATIVE.md §2). |
| **No state library** at first: screens call `api/` functions, as the SPAs do *(proposed)* | Redux, Zustand or React Query from day one | No dependency without a stated need (AGENTS.md "Dependencies"). Added when caching, or an offline queue after the first release (§5), needs it. |
| **Theme tokens as a TypeScript object**, filled from DripFunnel's values and overridden by the brand query *(proposed)* | Reading `shared/ui/tokens.css` | React Native has no CSS variables. The values match the `--df-*` tokens. |
| **Jest with the `jest-expo` preset** for component tests; logic tests can stay on Vitest *(proposed)* | Vitest for everything | React Native components need its Babel transform and native mocks, which `jest-expo` provides. The gates stay `typecheck`, `lint`, `test`. |

---

## 3. Folder structure

`pnpm-workspace.yaml` matches `apps/ui/*`, which doesn't reach two levels down, so it also lists
`apps/ui/mobile-app/*` (#496). The app's scripts are `start` (Expo's dev server, run by
`pnpm dev:mobile`), `typecheck`, `lint` and `test` (Jest with `jest-expo`). It has no `dev` script
because `pnpm dev` runs every `dev` script under `apps/`, and no `build` script because an Expo build is
EAS's job (BUILDS-AND-STORE-ACCOUNTS.md §2). Route files under `src/app/` use default exports, which
Expo Router requires; the root `eslint.config.js` allows them there and forbids imports from
`@dripfunnel/*` and `apps/` in the app (REACT-NATIVE.md §2).

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
        home.tsx  orders/  catalogue/  offers/  products/  to-ship.tsx  more/
                                catalogue/ and products/ (a supplier's tab) hold the list, [id] (the editor; `new` opens an empty one) and [id]/story (A+ content)
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

Built in #497 up to step 3, and in #498 for steps 4–5.

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
- **Built in #497** (`src/graphql/`): the client sends `Authorization: Bearer`, `X-Store` and `X-Supplier` when
  it has them (read afresh on every call; none exist yet), times out every call (15 s; the brand query
  5 s so a phone with no signal reaches its saved look quickly), and answers failures as an `ApiError` with
  a code. The API's codes pass through (`UNAUTHENTICATED`, `FORBIDDEN`, `READ_ONLY`, `STORE_REQUIRED`,
  `NOT_FOUND`, …); a code it doesn't know is `UNKNOWN`. The app makes three itself: **`NO_RESPONSE`** (no
  answer in time, or a page that isn't the API's JSON, such as Cloudflare Access's), `BAD_RESPONSE` (an
  answer that doesn't match its zod schema) and `UNKNOWN`. `NOT_CONNECTED` is only the API's, an
  integration that isn't connected, never "the network is down". `PLAN_LIMIT` is what the API sends for a
  plan gate (ui/README.md §3 names it `PLAN_LIMIT_REACHED`), so both are known. Each operation's answer is
  decoded with a zod schema written from `apps/api/schema/` (`typedQuery`), as the SPAs do.
- **The look** (`src/theme/`, `src/brand/`): the tokens are DripFunnel's `--df-*` values as a TypeScript
  object, light and dark. The mode is light until the signed-in person's own choice is known (ui/README.md
  §4; the session is #498). The partner's primary colour becomes the header and its accent the brand colour, and
  `corner` halves or removes the radii, as the portal applies them (`apps/ui/store` `brand/applyBrand.ts`).
  Fonts are not loaded: the brand's `font` is read but the app uses the system font until a card adds font files.
- **Built in #498** (`src/session/`): who may see which screen follows the session (`Stack.Protected` in the root
  layout): signed out sees `(auth)`, signed in with no store acting sees the chooser, a store acting sees the tabs and
  My profile. The session store keeps the token and the last store in secure storage, and every call a signed-in
  person makes goes through `sessionClient()`, which adds the bearer token, `X-Store` and `X-Supplier` and ends the
  session on `UNAUTHENTICATED`. The sign-in routes are plain POSTs, so `graphql/rest.ts` carries them; how they
  work is in REACT-NATIVE.md §5.1.
- **Built in #499** (`src/features/shell/`, `src/features/states/`): the shell is the header, the banners, the
  screen and the tab bar, all drawn by `app/(tabs)/_layout.tsx` from `nav.ts` for the role and supplier tier the
  membership carries (`Acting.role`, `Acting.tier`). `ShellDataProvider`, above the routes so My profile shares it,
  reads `me`, `navBadges`, `storeState` and `profile.theme` for the acting store, each read on its own so a failed one
  draws less (no badge, no banner) rather than stopping the app; it reads again when the app comes to the front.
  A `Button` marked `saves` (an account action: My profile takes no store state, as on the web) is off while the phone
  is offline (NetInfo); a screen that writes store data applies the store's view-only rule itself.
  Sheets and toasts come from `useFeedback()`. A screen draws a designed state (DESIGN.md §4) through
  `ShellScreen`, either one it knows (access denied, 404) or the one the development-only Scenario menu picks.
- **Built in #500** (`src/features/products/`, `src/api/products.ts`, `inventory.ts`, `productStory.ts`): Catalogue › Products and a supplier's Products tab are one list of stacked cards
  (`ProductsScreen`: search, sort, filter chips with the API's counts, Show more, Approve and Send back for a seat that holds `approve`).
  What a seat may do is the API's list of permissions (`me.acting.permissions`, `access.ts`), and nothing narrows the list in the app. The editor
  (`editor/`) keeps a form draft (`draft.ts`: prices typed in major units, sent as minor-unit strings through `minorOf`) and sends back, as loaded, every
  field it has no control for (address, category, shipping, tax, barcodes, other-currency prices), because a save writes every field it names; the
  listing sections, filters, size chart and video are left out of the input, which keeps them as stored. Photos come from the library or camera
  (`expo-image-picker`), go to `POST /api/assets` as raw bytes with the session's headers (not a signed URL: that is what the API has, FIRST-RELEASE (store) §19)
  and are read back with the same headers. A typed count is saved with `setStock` after the product; "Change with a reason" is `adjustStock`, applied at
  once. A+ content (`story/`) edits the draft modules and publishes them with the product. Not in the app yet: product kinds other than a physical
  item (MA 14, #507; they open read-only), collections (#501), import and export (#505), bulk actions, quick edit, and the listing sections the card
  left out (weight and box, tax category, collections and filters, specifications, FAQs, related, badges, legal fields, search listing, size chart,
  other currencies and markets), which stay as stored when the phone saves.
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
