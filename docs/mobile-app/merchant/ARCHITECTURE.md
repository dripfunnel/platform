# mobile-app/merchant: code architecture

How the code of `apps/ui/mobile-app/merchant` is laid out and how it talks to the platform.
The framework decision is [REACT-NATIVE.md](REACT-NATIVE.md); the look is [DESIGN.md](DESIGN.md);
builds and stores are [BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: the project is set up (#496), its foundations are built (#497) and so are getting in and My profile
(#498), the shell (#499), Products (#500), Collections (#501), Settings (#502), Orders and Customers (#503), Payment setup, Shipping and Customer accounts (#504), Import & export (#505) product kinds in the editor (#507), and Offers and Abandoned carts (#508), Home and Reports (#509), Developers (#510), Apps (#800), and Support access with the banner's Allow/Deny (#801), and the Activity log (#802); the other screens are placeholders.**
`app.config.ts`, `partners/`, `eas.json`, the Expo Router skeleton under `src/app/`, and `src/graphql/`,
`src/intl/`, `src/format/`, `src/messages/`, `src/theme/`, `src/brand/`, `src/session/`, `src/features/auth/`,
`src/features/profile/`, `src/features/shell/`, `src/features/states/`, `src/features/products/`, `src/features/collections/`, `src/features/settings/`, `src/features/orders/`, `src/features/customers/`, `src/features/import/`, `src/features/offers/`, `src/features/carts/`, `src/features/home/`, `src/features/reports/`, `src/features/activity/` and `src/api/` (`brand`, `auth`, `profile`, `shell`, `products`, `inventory`,
`productStory`, `collections`, `filters`, `menu`, `sizeCharts`, `settingsStore`, `settingsPeople`, `settingsWarehouse`, `settingsTax`, `settingsMarkets`, `settingsCatalogue`, `settingsPayments`, `settingsShipping`, `settingsAccounts`, `orders`, `order`, `customers`, `exportJob`, `imports`, `offers`, `carts`, `home`, `reports`, `settingsDevelopers`, `settingsApps`, `settingsSupport`, `activity`) exist (the placeholder screen in
`src/features/placeholder/` goes when the first real screen replaces it). Only `nav.ts` is still to build. Rows
marked *(proposed)* await a yes.

Last updated: 2026-10-19 (#802: Activity log, §3, §5). Before: 2026-10-19 (#801: Support access and the banner, §3, §5). Before: 2026-10-19 (#800: Apps, §3, §5). Before: 2026-10-19 (#510: Developers, §3, §5). Before: 2026-10-19 (#509: Home and Reports, §3, §5). Before: 2026-10-19 (#508: Offers and Abandoned carts, §3, §5). Before: 2026-10-19 (#507: product kinds, §5). Before: 2026-10-16 (#505: Import & export, §3, §5). Before: 2026-10-16 (#504: Payment setup, Shipping and Customer accounts, §3, §5). Before: 2026-10-15 (#503: Orders and Customers, §3, §5). Before: 2026-10-15 (#502: Settings, §3, §5). Before: 2026-10-15 (#501: Collections, §3, §5). Before: 2026-10-13 (#500: Products, §3, §5). Before: 2026-10-13 (#498: the session and getting in, §4–§5). Before: 2026-10-13 (#497: the foundations, §4–§5). Before: 2026-10-12 (#496: the project is set up). Before: 2026-10-09 (#493: own client and formatting, no offline queue, no in-app purchase).

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
                                catalogue/ and products/ (a supplier's tab) hold the list, import (Import & export), [id] (the editor; `new` opens an empty one) and [id]/story (A+ content);
                                catalogue/ also holds collections/[id] and size-charts/[id] (the Collections segment's editors)
                                orders/ holds the list, [id] (one order) and a layout
                                more/customers/ holds the list and [id] (one customer)
                                more/carts/ holds the list with its reminder settings and [id] (one cart)
                                more/reports.tsx is Reports; home.tsx is Home
                                more/activity.tsx is the Manager's Store activity (the Owner's Activity log is a Settings tab)
                                offers/ holds the list, new, [id] (one offer) and [id]/edit (the editor)
                                more/settings/ holds the Owner's list of tabs (Store info … Customer accounts, Developers, Apps, Support access, Activity log), [tab] (one tab on its screen) and market/[id] (the Markets editor)
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
  listing sections, filters and video are left out of the input, which keeps them as stored (the size chart goes only when it was changed, #501). Photos come from the library or camera
  (`expo-image-picker`), go to `POST /api/assets` as raw bytes with the session's headers (not a signed URL: that is what the API has, FIRST-RELEASE (store) §19)
  and are read back with the same headers. A typed count is saved with `setStock` after the product; "Change with a reason" is `adjustStock`, applied at
  once. A+ content (`story/`) edits the draft modules and publishes them with the product. Not in the app yet: bulk actions, quick edit, and the listing sections the card
  left out (weight and box, tax category, collections and filters, specifications, FAQs, related, badges, legal fields, search listing,
  other currencies and markets), which stay as stored when the phone saves.
- **Built in #501** (`src/features/collections/`, `src/api/collections.ts`, `filters.ts`, `menu.ts`, `sizeCharts.ts`): Catalogue › Collections is four parts under a tab bar (`CollectionsArea`, `AreaTabs`): the list of collections (`CollectionsList`) and the editor for
  one (`catalogue/collections/[id]`, `CollectionForm`), then Filters, Menus and Size charts, which the list reads again when it comes back to the front. The collections and the filters are read once for the area (`areaData.ts`).
  The rule builder writes a filter's values as one sentence and sends one rule per value; rules it doesn't draw (a product, a version, a price range), and a collection's image, sort and SEO, go back
  as loaded (`collectionDraft.ts`). **What a rule-based collection holds is the API's answer** (`collectionPreview` for the live count and first products, `products` for the search to pick from),
  never matched in the app. What a seat may do is the API's `catalog.read` and `catalog.write` (`access.ts`): Staff looks only, a supplier has none. Deleting says its consequence in a sheet first, a
  refusal shows by its code (`errors.collections`, `filters`, `menus`, `sizeCharts`), and leaving an editor with unsaved changes asks first (`useLeaveGuard`). Filters (`FiltersTab`) add, rename and delete values, merge look-alikes and switch a filter between shoppers and internal, each change that loses or alters something saying its consequence in a
  sheet first. Menus (`MenusTab`) save each change at once at the revision read, as the web's does, and a row opens a sheet to move, nest or remove it (`menuRows.ts`). Size charts (`SizeChartsTab`, `catalogue/size-charts/[id]`, `SizeChartForm`) start from a template in the store's unit, edit as a grid that scrolls sideways, convert cm and in, and ask "change all or make a copy" for a chart used on several products. A physical product picks its size chart in the product editor (`SizeChartCard`, for a merchant seat when Settings › Catalogue has size charts on); it is sent as `sizeChartId` only when changed, and `null` takes it off. Not in the app: a supplier's own size charts (the web's "Your products" tab), a collection's image, SEO and sort order, and menu items that link to pages
  or addresses (they are kept and shown).
- **Built in #502** (`src/features/settings/`, `src/api/settings*.ts`): More › Settings is the Owner's, a list of rows (Store info, People, Suppliers, Warehouse, Tax setup, Markets, Catalogue; #504 adds Payment setup, Shipping and Customer accounts) that each open on their own screen (`SettingsTabScreen`). A seat that is not an Owner is told it has no access before anything is read (the API refuses every write to one, but a few reads need only `catalog.read`, so the app's gate is the only thing between a Manager and those: `access.ts`), and a store past due shows every tab without saving. Each tab loads through `TabFrame`, which carries the gate and the designed states, and writes through `FormSheet`, a bottom sheet that states the consequence first and keeps a refusal, worded by its code (`errors.settings*`), with what was typed. Store info saves its details, its currencies and its languages as three cards that don't reload one another; People and Suppliers list the store's people and companies with the invitations the server sends by email (the app holds no link or token); Warehouse lists the store's locations to manage and its suppliers' named apart and read-only; Tax setup shows the rates the API holds and never works a price out; Markets is a list with the market's editor on its own screen (`more/settings/market/[id]`, saved at the revision read, `STALE_REVISION` and `NOT_FOUND` read the markets again); Catalogue is the preset, the sections by plan and the badges. **Not in the app:** the shop's web address and Connect your own domain (Storefront › Site settings, #470), a market's own domain, and Catalogue's legal details, custom fields and plan meters, which wait for their API (FIRST-RELEASE (store) §15). Close my store (MA 18, #511) goes after Store info's last card.
- **Built in #503** (`src/features/orders/`, `src/features/customers/`, `src/api/orders.ts`, `order.ts`, `customers.ts`, `exportJob.ts`): the Orders tab is a list of stacked cards (six status chips with the API's counts, search, Show more) and an order opens on `orders/[id]`: its lines by who packs them, shipments, returns, payment, the shopper and the history. Totals, refunds and tax are the API's, never worked out in the app; money is digit strings, and a typed refund amount goes through `minorOf`. Ship is one sheet (quantities, a location, then **Book a {courier} label** through `bookLabel`, enter tracking by hand, or hand over a pickup); Add tracking, Start return, Mark as received, Cancel return, Refund (units grouped by who refunds them, a goodwill amount, restock, and a supplier's lines overridden with "recorded against {supplier}, for you to settle with them") and Cancel order each say their consequence in a sheet first and keep a refusal, by its code, with what was typed (`errors.orders`, `errors.customers`). What a seat may do is `me.acting.permissions` (`orders.fulfil`, `orders.refund`, `orders.mark_paid`, `customers.read`, `.write`, `.export`); a control a seat can't use is absent. Customers (More › Your shop) is People with search and group chips, and Groups; a customer opens on `more/customers/[id]`, with tags, the team's note, marketing consent (the team can only record that they asked to stop) and the newest orders, and each order opens `orders/[id]`. **Exports** are jobs: `useExportJob` requests one and reads it back until it is ready, and `shareCsv` hands the CSV text the API returns to React Native's built-in Share (decided on #503: no file dependency, so it is text, not a `.csv` attachment). A supplier seat is told it has no access to Orders; its To ship and Your sales are #506. **Labels:** the connected couriers come from `shippingSettings`, which needs `shipping.configure` (Owner only), so a Manager or Staff seat enters tracking by hand; the label file itself is not opened in the app. Not in the app: Print (packing slip, invoice), adding a team note to an order.
- **Built in #504** (`src/features/settings/payments/`, `shipping/`, `accounts/`, `src/api/settingsPayments.ts`, `settingsShipping.ts`, `settingsAccounts.ts`): three more Settings tabs, Owner only, on the same `TabFrame` and `FormSheet`. **Payment setup** lists the region's ways to pay as `gateways` answers them: live, test only, not connected, or not set up here, which has nothing to press. **Stripe connects on the web portal** (decided on #504): its button says what will happen, then opens `https://<portal domain>/settings/payments` in the phone's browser, never an in-app web view, and the app calls neither `connectStripe` nor `finishStripeConnect`, because Stripe's way back is a web page that only the portal's own session can finish (apps/api `hooks/stripeConnect.ts`). The tab reads `gateways` again when the app comes to the front (`useRefreshOnReturn`), so the connected state shows on return. PayPal, Razorpay, Cashfree and PhonePe take their own named keys in a sheet (secrets masked, sent once, never read back); cash on delivery turns on after its consequence is said; a bank transfer asks for the details shoppers pay to. A provider that cannot be reached (`PROVIDER_UNAVAILABLE`) leaves the sheet open with what was typed. **Shipping** is one draft saved over its revision (`shippingDraft.ts`): the courier's rate, a flat rate and collection in person can be on together, each amount is typed in major units and sent as a minor-unit digit string through `minorOf`, and `STALE` reads the settings again keeping what was typed. The couriers are the partner's accounts, so Connect takes no key, and one disconnected elsewhere answers `NOT_CONNECTED`, which reads the list again so it shows Not connected. A delivery list is typed or pasted as codes in the store country's shape, not picked as a file (no file-picker dependency; decided on #504). **Customer accounts** picks email, mobile or both, warns with the count of phone-only shoppers, and says the storefront follows it from now on before it saves. A webhook address is shown for the owner to paste into the provider; no key, secret or token is ever shown.
- **Built in #505** (`src/features/import/`, `src/api/imports.ts`): Import & export is `catalogue/import` (a supplier's tab: `products/import`), opened from a button under the Products list's title (Owner, Manager and a catalogue-tier supplier import; anyone who reads the catalogue exports, a Stock-only supplier excepted; the API decides each call again). **The CSV goes to the API as its text** (`startCatalogImport(file)` takes the file's contents, 5 MB at most), read with `fetch` from the cache copy the system document picker returns (`expo-document-picker`; `expo-file-system` refuses that folder in Expo Go), so there is no upload to sign, and **no column is mapped**: the API reads the template's headers, as the web portal does (FIRST-RELEASE (store) §13). Check, confirm and the run follow CatImport's Choose → Check → Import → Done, polled every 2 s; the screen finds a run still going when it opens (`catalogImports`). **Connect Shopify** opens Shopify in the phone's browser; the approval ends on the portal's `/products/import?shopify=finish&key=…` page, which only a signed-in portal session can finish, and the app takes no link back (DESIGN.md §5), so it reads `shopifyConnection` again when it comes to the front and opens the product picker once it says connected. Exports (products and stock) use `common/useExportJob` and `common/shareCsv` like Orders and Customers (decided on #503: the CSV goes to the share sheet as text, no file dependency), and so do the template and a run's file of problems; a finished export opens the share sheet by itself, and the caller's recent files can be shared again. Not built: the shell's banner and toast for a run the person left (the run is found again on this screen).
- **Built in #506** (`src/features/supplier/`, `src/api/supplier.ts`, routes `to-ship/` and `more/sales`, `more/team`): a supplier's own screens, on the Store API as it is and sharing no code with the web portal. **To ship** is the Orders list for a supplier (`useOrderList` with the supplier's own `loadSupplierOrders`, which asks for no money, payment or test flag; `OrderFilters` with the four chips a supplier has; `SupplierOrderCard`): the API answers a supplier its own parts, so the row's `partState` and `shippingMode` say where the items go ("For {store}, send to the store" for a `to-store` part, which names no shopper; the shopper's name and city for a `to-shopper` one) and no total is drawn. An order opens on `to-ship/[id]` through `loadSupplierOrder`, whose query asks for no money, payment, email or phone; a `to-shopper` part shows the delivery name and address the API sent, a `to-store` part only "Send your items to {store}". **Mark shipped** is `SupplierShipSheet` (`shipItems` from the supplier's own locations, `loadSupplierPlaces`, with a courier and tracking if it has them; for a `to-store` part it says "Send {n} items to the store"), offered to `vendor-orders-fulfil` alone (`orders.fulfil`); `vendor-orders-read` reads, and an order that isn't the supplier's is `null` or `NOT_FOUND`, which is "not found". **Your sales** (`more/sales`) reads `mySales` in pages of 25 for a seat with `sales.read` and exports the supplier's own orders (`exports.orders`); **Your team** (`more/team`) reads `mySupplierTeam` for a seat with `supplier.team` (a Supplier admin) and invites, resends, cancels, changes the role and removes through sheets that state their consequence first, a refusal such as `LAST_ADMIN` staying in the sheet. Every other seat is told it has no access before anything is read. What a seat may do is `me.acting.permissions` (`access.ts`), the tiers' own (`storePermissions.ts`). A supplier's returns and refunds, and its order history, are not in the app.
- **Built in #507** (`features/products/editor/` `kindDetails.ts`, `KindCard`, `DownloadCard`, `ServiceCard`, `GiftCardCard`, `useDownloadFile`, `src/api/productKinds.ts`): the editor's "What are you selling?" (a physical item, a download, a service, a gift card), a merchant seat's only; a supplier's editor has none and the API refuses it `SUPPLIER_FIELD`. The product saves first, then the kind's card at the revision that answered (`saveProductKind`), only when the kind or its details changed. When the card fails after the product saved, the page keeps what was typed, the banner says so by the code's words (`errors.productKind`), and the next save sends the card again, even for a new product, which stays on the page. A **download's file** is picked with the system document picker (any type; the API checks it) and posted as raw bytes to `POST /api/assets?kind=download`, up to 30 MB, as the web portal does: the API has no signed upload, which the card's "Decided" assumed. A file over 30 MB by the picker's size, or by the bytes read, is refused before it is sent; a refusal shows by code (`errors.productFile`) and a save waits for an upload still going. The file is named by its type and size, as the API keeps no name. How often and how long its link works are chips. A **service** keeps an optional length and place. A **gift card's** amounts are its versions (one kind of choice, "Amount", named as "₹500"; none for a single amount), typed in major units and sent as minor units, in place of the price and choices cards; switching a product to a gift card makes its prices its amounts and drops its other choices (Discard brings them back). Its expiry is 1, 2, 3, 5, 7 or 10 years or never, none shorter than the API's `shortestMonths`, which arrives once the product is saved as a gift card; before that the hint states both countries' rules, and a too-short expiry is the API's `EXPIRY_TOO_SHORT`. Staff and a read-only store see the cards with nothing to change. **Not in the app:** licence keys (a stored pool shows a note and is saved as it was; a new download is a file), a gift card's cards issued and Issue a card (FIRST-RELEASE (store) §11, #328).
- **Built in #508** (`features/offers/`, `features/carts/`, `src/api/offers.ts`, `carts.ts`): **Offers** is a tab of stacked cards (four status chips with the API's counts, search by name or code, a type chip row and a "how shoppers get it" chip row, "Show more"); each card's "⋯" opens its actions (Edit, Open, Share code, Turn off, Turn on, End now, Duplicate, Delete), and a floating Create offer starts one. Turn off, End now and Delete say their consequence in a sheet first, a refusal shows by its code (`errors.offers`) and a Duplicate opens its copy. An offer opens on `offers/[id]`: its sentence, its shared code (shared as text; it is not a secret, so it stays on the share sheet; the clipboard module is only for a secret, #510), a code offer without one hands out **single-use codes** (runs with used and unused, make another within the API's limits, and a run's file as a job shared as CSV text through the share sheet, `offers.export` only), and its details. **The editor** (`offers/new`, `offers/[id]/edit`, `features/offers/editor/`) is the kind, then one page of sections in OFFERS-DESIGN §1's order under a summary that is collapsible; `offerDraft.ts` maps each kind's form to the one `OfferInput` (amounts typed in major units and sent as minor-unit digit strings, a fixed amount and a minimum with a box per currency the store sells in and the empty ones converted at the reference rate, dates typed as a date and a 24-hour time on the store's wall clock and sent as instants, conditions the form does not draw kept as they came). Save asks Start now / Schedule / Keep off on a new offer and confirms a change to a live one; a taken code is said by the code box, someone else's save offers "Load their version" or "Keep mine", and the saved offer's page replaces the editor so a second Save cannot make a second offer. Staff read the list, the page and the codes' runs and are told they cannot edit; a supplier is denied before anything is read; a read-only store opens the editor with nothing to change. The Owner and Manager have `offers.write`, and `offers.export` is theirs alone; the API decides each call again. **Not in the app:** recipes, "Check a code a customer gives you", an offer's results (uses by day, sales), "Create a group" from the editor (Customers has groups), and the web's kept-draft recovery. **Abandoned carts** (More › Your shop) is the Carts list (the last 14 days' tiles, In progress / Recovered / Not recovered with counts, search, cards with the reminder status line) and a second part, Reminders, under a segmented control. A cart opens on `more/carts/[id]`: its lines as they would be bought now, what happened, the shopper and links to the order and customer. Send reminder now, Stop reminders (with a note) and Resume reminders are sheets that say what they do first; the 10% single-use code is offered on the plan's `automatic` only. The Reminders part is one draft saved at the revision read (three steps, who gets reminded, quiet hours, once a week), with WhatsApp only in an Indian store on `automatic` and steps 2–3 locked below it; "Send me a test" goes to the person's own email only. Staff and a read-only store see it all with nothing to change (`carts.read`, `carts.write`). Times read "25 min ago" from `formatDuration`, since Hermes has no `Intl.RelativeTimeFormat` (REACT-NATIVE.md §6). **Not in the app:** the web's reminder preview pane, bulk selection and "Copy cart link".
- **Built in #509** (`features/home/`, `features/reports/`, `src/api/home.ts`, `reports.ts`): **Home** is one read (`loadPage`: the seat’s permissions, `home`, and for a new store’s Owner the locale line’s facts) that picks `ActiveHome` (`homeApp`) or `NewStoreHome` (`PortalHome`) by `isActiveStore` (an order, or `setup.products`), and reads again when the tab comes to the front. Every figure is the API’s and a null one is left out: `headlineOf` shows yesterday’s sales a currency (the API has no figure for today) or, for a seat without money, today’s orders; `needsOf` words the three counts and links each to its list (Orders and Catalogue take `?filter=`, so `ProductsScreen` takes an `initialFilter`; each press adds a `visit` token, which the two routes key on, because a tab stays mounted and the chip would otherwise apply only once); the checklist (`setupOf`) holds only the items the API gave the seat. **Reports** (`ReportsScreen`, route `more/reports`) reads `report` for the range and currency on screen and the supplier panel on its own, since it has its own plan switch; `PLAN_LIMIT` names the plan (`planOf`, `details.unlockedBy.name`) for the locked view, for a refused export and for the builder, which keeps the refusal in its sheet. An export is a job (`useReportExport` over `common/useExportJob`: the ask throws its refusal to the caller, the job is read back with `reportExport`) and its CSV goes to the share sheet. The builder is the rows sheet (`feedback.sheet`) then `CustomColumnsSheet`, sending `exportReport(panel: custom)`. What a seat may do is `me.acting.permissions`: `reports.read` for Reports (never a supplier), `catalog.write` for Add a product, `settings` for the locale line. **Not in the app:** Needs you’s payments to collect and courier items, `PortalHome`’s Skip, team requests, today’s sales.
- **Built in #510** (`features/settings/developers/`, `src/api/settingsDevelopers.ts`, `features/common/copyText.ts`): **Developers** is a Settings tab, Owner only, on the same `TabFrame` and `FormSheet`, with API keys (the prototype's storefront key and "Websites allowed to use it" are not drawn: the Store API neither reads nor changes them, FIRST-RELEASE (store) §15, Part 1). A key shows by its prefix with what it can do, whole store or one active supplier, last used, who made it, when it expires and until when a rotated-from key works; Create asks a name, what it can do (`apiKeyChoices.scopes`), who it works for and a lifetime, and Rotate and Revoke say what happens first. **A secret is shown once**: `createApiKey` and `rotateApiKey` answer it, `SecretCard` holds it in this screen's state only (never stored, logged or read back; the list query asks for no secret field) until "I've stored it" or until the screen is left, and while one is shown no other key is made. **Copy** puts it on the clipboard (`expo-clipboard`, decided on #510: the share sheet would offer a live secret to every app, so Offers' code and the exports stay on the share sheet) and says when the phone refuses; the text is selectable too. **Not in the app:** the storefront key and allowed websites, and a leave guard for an unstored secret (leaving drops it). Webhooks, Apps, Support access and the Activity log are the cards that follow #510 (#800, #801, #802 and the Webhooks card).
- **Built in #800** (`features/settings/privateApps/`, `src/api/settingsApps.ts`): **Apps** is a Settings tab, Owner only (the folder is `privateApps/` because `apps/` is a forbidden import pattern), listing each installed app with its developer, who installed it and when, what it can see, when it was last used, and whether it is paused by the platform or never received its access (`connection: failed`: remove and install again). "Open app" is a link to its own site, shown only when that parses as https; nothing of the app runs in the phone. "Add an app" takes the install link and reads the app's id from it (**decided on the web portal's #333**: the first UUID anywhere in an https link, since the API names apps by id and no link format is set); then the consent sheet says what it will and won't be able to do (the reads it wasn't given, never changing the store, never payment details or passwords), Install sends back the scopes it showed, and on `SCOPES_CHANGED` the sheet shows what the app asks now. A link that is not https, or names no app, is refused with words. Remove restates that its access ends and what it copied stays with it. A `FormSheet` write may answer `null` to leave the sheet open, which is how "Continue" moves from the link to the consent. A read-only store shows the list with nothing to change. Support access, the Activity log and Webhooks are the cards that follow (#801, #802).
- **Built in #801** (`features/settings/support/`, `features/shell/SupportAskBar.tsx`, `src/api/settingsSupport.ts`, `brand/BrandContext.ts`): **Support access** is a Settings tab, Owner only: the On/Off switch (turning it off restates that open sessions end and says how many did; turning it on asks nothing), how a session works, and the support access log of the last 90 days (who, why, when and how long, whether they could change things: allowed by whom, a request denied, or read-only), with "Show older". **Decided here:** the switch stays usable in a read-only store, because the API lets a privacy control change then (`whileReadOnly`); the partner is named by the brand's product name. **The elevation banner**: `storeState.support` also reads `sessionId`, `access` and `writeRequest`; while support asks to make changes the banner says so with the agent's note and, for a seat holding `support.allow_write` (Owner and Manager), shows **Allow** and **Deny**, each a sheet that states what it does first (`allowSupportWrite`, `denySupportWrite`; a request no longer open is `NOT_PENDING`); once allowed the banner reads "Changes allowed". While a support session is open the shell reads the store's state again each minute, so a request shows without the app being reopened. `useBrand` lives in `brand/BrandContext.ts` (re-exported from `BrandProvider`) so a screen that only reads the partner's name does not load the device storage the provider reads the saved look from. The Activity log and Webhooks are the cards that follow (#802 and the Webhooks card).
- **Built in #802** (`features/activity/`, `features/settings/activity/`, `src/api/activity.ts`, route `more/activity`): **Activity log** is one view for the Owner's Settings tab and the Manager's **Store activity** (More › Account, `more/activity`; `activity.read`, and anyone without it is told so and nothing is read; a supplier is told so too). Entries are in words (who, what, Done, Refused or Failed, and when; a support session's entries name the agent behind it, a person's name never their email, and a code the app has no words for shows itself), 50 a page with "Show older"; opened, an entry shows its changes, reason and how it was done, "Everything by {name}" and, for a product or an order, a link to it. The filters (person, what by `activityWhats`, and search after typing settles) are the screen's state, not an address; **decided here**: the person list offers who is in the entries loaded and the one picked, since no API lists the log's people, and "Show older" replaces the prototype's scroll-to-load. A read-only store still reads and exports. **Export CSV** is `activity.export`, the Owner's alone: a Manager sees it off with "Only the store owner can export", and the API decides again; it is a job (`useActivityExport` over `common/useExportJob`) whose CSV goes to the share sheet as text (decided on #503). **Not in the app:** the web's address-held filters. Webhooks is the card that follows.
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
