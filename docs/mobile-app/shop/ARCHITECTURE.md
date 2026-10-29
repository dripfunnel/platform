# mobile-app/shop: code architecture

How `apps/ui/mobile-app/shop` is laid out and how it talks to the Shop API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); builds and per-store configuration are
[../README.md](../README.md) §3.

**Status: the project is set up (#860); Home, Browse, search and the product page are built (#861); sign-in, register, reset, Account and addresses with a map pin are built (#862), and the cart and checkout with cash on delivery and bank transfer are built (#863), and so are paying with Stripe and PayPal (#864) and with Razorpay, Cashfree and PhonePe (#865), and orders, live delivery tracking and push notifications (#866), and so are the store's languages and currencies, its legal pages and the offline banner (#867)**: `app.config.ts` reading `stores/<STORE_KEY>.env` (the `dev` store, host `dev.my-store.localhost`), `eas.json`'s `dev` profile, the Shop API client sending `X-Shop-Session` and `X-Shop-Cart` from secure storage, the store's name and logo at startup (the last look is saved on the device) and no placeholder tab left. Home, Browse (collections, filters, sort, Show more), search and the product page with add to cart read the catalogue through `features/catalogue/`; the last page each loaded is kept on the device so a phone with no signal shows it under a banner (§2).

Last updated: 2026-10-28 (#878: the scrubbing and the Crashlytics wrapper moved to `@dripfunnel/mobile-shared/crash`, §2, §3). Before: 2026-10-28 (#876: `crash/`, crash reporting with Firebase Crashlytics, §2, §3). Before: 2026-10-28 (#867: `features/markets/`, `features/legal/`, `features/states/`, the language and currency headers and `@react-native-community/netinfo`, §2, §3). Before: 2026-10-27 (#866: `features/orders/`, `features/tracking/`, `push/`, the `orders/` routes, `expo-notifications` and a guest's kept order token, §2, §3, §4). Before: 2026-10-27 (#865: the Razorpay, Cashfree and PhonePe packages built, with `expo-build-properties` and `cashfree-pg-api-contract`, §2, §3). Before: 2026-10-27 (#864: `checkout/payments/`, the two packages built, the Stripe plugin and `APPLE_PAY_MERCHANT_ID`, §2, §3). Before: 2026-10-27 (#858: the Shop API now answers `order.delivery` and registers customer and guest-order push devices, §4). Before: 2026-10-27 (#863: the cart and checkout, §2 and §4; `AddressFields` is shared by Account and checkout; the shared client knows the checkout's refusal codes). Before: 2026-10-26 (#862: sign-in, register, reset, Account and addresses with a native map pin, §2 and §3; the session is held by `ShopProvider`; Delete my account waits for a Shop API operation). Before: 2026-10-26 (#861: Home, browsing, search and the product page; the two dependencies they need, §3; the offline cache is capped, §2). Before: 2026-10-26 (#860: the project is set up; the client's extra headers, §2). Before: 2026-10-26 (#857: Razorpay, Cashfree and PhonePe for the app's native sheets, §4). Before: 2026-10-23 (#856: payment for the app's native sheets, Stripe and PayPal, built, §4). Before: 2026-10-23 (#855: the session and cart tokens need no change; the brand is `store`, without colours or font, §4). Before: 2026-10-22 (first version).

---

## 1. Rules

The merchant app's rules hold (merchant/ARCHITECTURE.md §1), with the Shop API in place of the
Store API: the API decides and the app displays; nothing per store in code; no secrets in the app
or the repo; text from `messages/`, formatting through `format/`, errors by code, and every screen's
empty, loading, error and offline states. **API changes are only those in §4**, each built on its
own Shop API card.

---

## 2. Folder structure

```
apps/ui/mobile-app/shop/
  app.config.ts             reads and validates the store's env file (../README.md §3)
  stores/<storeKey>.env     one per store: public build-time values
  stores/<storeKey>/        that store's icon, splash and listing text
  eas.json                  one build profile per store
  src/
    app/                    Expo Router routes
      _layout.tsx           polyfills, brand, session, push
      (tabs)/               home  browse/  cart  account/   (cart is the cart screen)
      (auth)/               sign-in  register  reset
      (tabs)/browse/        index  all  search  collection/[slug]
      (tabs)/account/       index  addresses  address
      product/[handle]  checkout/index  orders/[id]  orders/[id]/track
    features/<area>/        screens per area; catalogue/ holds Home, Browse, collection, search and the product page; account/ the sign-in, register, reset and Account screens; addresses/ the saved addresses and the pin (its country rules copy the website's, and `rules.parity.test.ts` fails when the two differ; `AddressFields` is the form and pin both Account and checkout use); cart/ the cart screen and the totals; checkout/ one screen that walks contact, address, delivery, payment and review, then the confirmation (`steps.ts` says where each refusal sends the shopper), and `payments/` for Stripe, PayPal, Razorpay, Cashfree and PhonePe (`stripe.ts`, `paypal.ts`, `razorpay.ts`, `cashfree.ts` and `phonepe.ts` open each provider's sheet, `sdks.ts` loads the three Indian SDKs on first use, `settle.ts` is the bounded read until the order is paid, `pay.ts` is one attempt, `PayScreen.tsx` its states); common/ what they share (ui, fields, the load hooks, the offline cache, error words)
    api/<area>.ts           the app's GraphQL operations, typed from apps/api/schema/shop.graphql
    session/                the customer's session token and the cart token, in secure storage
    testing/                the fake Shop API and the renderer the screens' tests share
    brand/                  the store's look from the Shop API
    push/                   permission, the Expo token, opening the order a push names (built on #866; nothing runs for a store with no `EAS_PROJECT_ID`)
    crash/                  crash reporting (built on #876; nothing runs for a store with no Firebase files): the scrubbing (a code or a class and its frames, never a message) and the wrapper over Crashlytics (started once; the scrubbing sits in front of its own global handler, and its unhandled-promise-rejection handler, which would record an error's raw message, is replaced by one that records the scrubbed error) are `@dripfunnel/mobile-shared/crash`, moved there on #878 for the merchant app, `CrashEffects.tsx` starts it and gives the signed-in customer's opaque account id, `CrashBoundary.tsx` reports a screen that throws and shows a message to try again
    features/orders/        the list and an order; `WithOrderAccess` reads an order the way its owner does (a guest by the token kept for it, a customer by the session)
    features/markets/       the shopper's language and currency: `MarketsProvider` (above `ShopProvider`) reads the phone's copy, asks the store what it offers, and remounts everything below on a new pick; `choice.ts` is the rules (the default language, the headers), `storage.ts` the phone's copy, `MarketsScreen.tsx` the two lists
    features/legal/         the five policy pages: `policies.ts` builds the storefront's address and opens it in the in-app browser, `LegalScreen.tsx` lists them, `PolicyLinks.tsx` links the ones a sentence names
    features/states/        `OfflineStrip.tsx`, the banner on every screen (whether the phone is online comes from `@dripfunnel/mobile-shared/connection`, which the merchant app uses too)
    features/tracking/      the tracking screen, its map, rider card, handover code and steps; `tracking.ts` is what each state may show, `useLivePolling.ts` the 15-second ask
    nav.ts  messages/
```

Foundations (`graphql/`, `format/`, `intl/`, `theme/`) come from `apps/ui/mobile-app/shared`
(../README.md §2). The shared client takes `extraHeaders`, read on every call, for the Shop API's
`X-Shop-Session` and `X-Shop-Cart` (#860). Built so far: the tokens are read from secure storage at start
(`session/tokens.ts`; the cart token is kept apart, under `<host>.cart`) and the writers come with sign-in and the
cart (SH 9, SH 10; the cart screen and checkout send the cart token on every call). `ShopProvider` holds the one client the screens call with and the session (`signedIn`, `startSession`, `endSession`: a sign-in keeps its token in secure storage and drops the guest cart token, whose cart the API has claimed for the account; sign-out asks the API to end the session and removes the token whatever the answer); `addToCart` and every cart write answer a guest's cart token, which `saveCartToken` keeps. `pnpm dev:shop` starts Expo's dev server for the `dev` store; the app's theme stays
DripFunnel's palette (§4: no colours served).

**Language and currency (#867).** `src/messages` speaks one language at a time, `locale`, set by `MarketsProvider` before the screens render: the shopper's language when there is a catalogue for it, else English, so adding `messages/hi.json` is all `hi` needs. The Shop API client sends `X-Shop-Language` and `X-Shop-Currency` from the choice on every call, and a kept offline page is served only in the language and currency it was loaded in.

**Offline (#861, #867).** Browsing keeps no cache layer of its own: each screen's first answer is saved in the device's storage under one slot (home, collections, a collection's products, a product), and served only to the same request, when the phone gets no answer (`NO_RESPONSE`). Product pages and collection pages are kept 20 at a time, the most recently loaded, so browsing many products cannot fill the device's storage. It shows under the "You're offline" banner; with nothing kept it shows the offline state. Search is never kept, and recent searches stay on the device and are never sent. A write (add to cart) is not offered while the page shown is a kept one.

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-notifications` | Order and delivery pushes (built on #866, at the version Expo SDK 57 bundles). Pushes come through Expo's push service (api/DELIVERY.md §6), so the app registers an Expo push token for the store's own EAS project (`EAS_PROJECT_ID`, README §3), and on Android needs the store's Firebase file (`GOOGLE_SERVICES_FILE`). It loads only for a store that sets them (`shared/push/sdk.ts`, shared by the shop and delivery apps): Expo Go cannot do remote push on Android and logs an error on import. Its config plugin is always in the build; the permission is asked only after the first order |
| `@react-native-community/netinfo` | Whether the phone is online, read once in `@dripfunnel/mobile-shared/connection` (built on #867, moved there from the merchant app; the shop lists it too, so its build links the native module): the banner on every screen, and a button that writes is off while offline. Reading `NO_RESPONSE` from the API alone would not say so before a request is made |
| `expo-secure-store` | The session and cart tokens |
| `expo-location` | "Use my location" on the address pin (built on #862): asked only while the app is in use and only when the shopper taps for it; its geocoder also puts the pin where the typed address is, the way that needs no map (WCAG 2.2, 2.5.1). A pin is dropped by hand only on a map zoomed in to about a city |
| `react-native-maps` | The address pin (built on #862) and the live tracking map (Google Maps on Android, Apple Maps on iOS). Android takes its key from the store's optional `GOOGLE_MAPS_ANDROID_KEY` (../README.md §3) |
| `@stripe/stripe-react-native` | Stripe's Payment Sheet (built on #864, at the version Expo SDK 57 bundles, `0.64.0`). Set up only from the Shop API's answer (the connected account's key and id, the intent's secret, the shopper's customer and ephemeral key); the app holds no key and sends the SDK's own API version (`Constants.API_VERSIONS.CORE`) with `placeOrder` and `payOrder`. Its config plugin switches on Google Pay, and Apple Pay for a store whose file names `APPLE_PAY_MERCHANT_ID`; the Payment Sheet decides what it shows |
| `react-native-razorpay` | Razorpay's checkout (built on #865, `3.0.0`): opened from the API's order id, key id and amount in minor units, with the shopper's email and mobile number prefilled; the app holds no key. It ships no types, so `src/types/` declares the little the app uses |
| `react-native-cashfree-pg-sdk` | Cashfree's checkout (built on #865, `2.5.1`): `doWebPayment` with the API's payment session, in the sandbox for a `test` store and production for `live`, never a default. The SDK answers through a callback, which the app removes after each attempt so a retry is not answered twice |
| `cashfree-pg-api-contract` | `CFSession` and `CFEnvironment`, which the Cashfree SDK takes as arguments and does not re-export; pinned to the version the SDK pins (`2.2.0`) |
| `react-native-phonepe-pg` | PhonePe's checkout (built on #865, `3.1.2`): `init` with the merchant id, then `startTransaction` with the SDK order's id and token as a `PAY_PAGE` payment; logging is off. Its Android SDK is served from PhonePe's own Maven repository, not Maven Central |
| `expo-build-properties` | Adds that Maven repository (`https://phonepe.mycloudrepo.io/public/repositories/phonepe-intentsdk-android`) and the `upi` query Android 11 and later need to find UPI apps; iOS gets the UPI apps' schemes (`phonepe`, `tez`, `paytmmp`, `paytm`, `bhim`) in `ios.infoPlist` (#865). No hand-written config plugin |
| `expo-video` | The product page's video (#861): a hosted file plays in the product gallery; a video that is only a link to a page opens with `Linking` instead |
| `react-native-gesture-handler` | Pinch to zoom on a product photo (#861), the same on iOS and Android, with a double tap and the screen reader's zoom action as the single-pointer way (WCAG 2.2, 2.5.1); React Native's own ScrollView zoom is iOS only. Callbacks run on the JS thread, so it needs no `react-native-reanimated` of its own |
| `@react-native-firebase/app`, `@react-native-firebase/crashlytics` | Crash reports (built on #876, decided 2026-10-22): in each store's own Firebase project, the one its Android push already uses, through the packages' Expo config plugins, which need the store's `google-services.json` **and** `GoogleService-Info.plist` (`GOOGLE_SERVICES_FILE`, `GOOGLE_SERVICE_INFO_FILE`), so the packages are in the app for every store and their plugins only for a store with both files. The Firebase Apple SDK is Swift Package Manager only, so such a build links its pods as dynamic frameworks (`expo-build-properties` `ios.useFrameworks`); **not yet proven alongside Stripe, Razorpay, Cashfree and PhonePe on a device**, which the first preview build of a store with Firebase confirms (BUILD-CHECKLIST §5). Loaded on first use, so Expo Go and a store without the files never import them, and off in development builds. Their dependencies' install scripts (`@firebase/util`, `protobufjs`) are not run (`pnpm-workspace.yaml`) |
| `promise` | The promise implementation React Native already uses (`8.3.0`, the same copy): `@dripfunnel/mobile-shared` depends on it directly only to reach its unhandled-rejection tracker (`promise/setimmediate/rejection-tracking`), which Crashlytics enables with a handler that records an error's raw message. Enabling the tracker again after Crashlytics has replaces that handler with one that scrubs (`mobile-shared/crash/report.ts`); pnpm's strict layout would not let the package import it otherwise |
| `expo-web-browser` | PayPal (built on #864), decided on #856: its approval page in the in-app browser (`openAuthSessionAsync`), which returns to the app's scheme. PayPal has no official React Native SDK, so the alternative was our own Expo module around its native SDK to build and keep up. The API side is the same Orders v2 order either way |

The three Indian SDKs are native modules with no Expo plugin, and none of them is in Expo Go, so they load on first use (`checkout/payments/sdks.ts`): importing one in Expo Go can throw on iOS, and a static import would take the whole checkout down with it. In Expo Go a payment through one says it could not start and the rest of the app runs; a payment is tried in a development build with the provider's sandbox keys on the store (docs/setup/local.md).

---

## 4. Shop API changes the app needs

| Change | Why |
|---|---|
| ~~A bearer token beside the cookie~~ **Nothing to build** (decided on #855, 2026-10-23): the Shop API has no cookie and checks no `Origin`. Sign-in answers the session token in the body (`sessionToken`) and the app sends it as `X-Shop-Session`; a guest's cart token comes from `addToCart` and goes back as `X-Shop-Cart` (ACCESS.md §2.1) | An app has no cookie jar, and needs none |
| **The store's brand**: **built as the Shop API's `store`**: name, description, logo, favicon (the app's mark), tagline, contact, social. Its **colours and font are not served**: `app_shop` has no grant on the colours (DATA-MODEL.md §7.8) and no font exists. The app has no per-store colours or font until a card adds them | The app's look at runtime (../README.md §3) |
| ~~**`registerPushDevice`, `unregisterPushDevice`** for a signed-in customer or a guest's order~~ **Built on #858**: `registerPushDevice(token, platform, orderId)` (a guest names the order and holds its token; a signed-in customer needs no `orderId`) and `unregisterPushDevice(token, orderId)`; the app unregisters before it signs out | Order pushes (api/DELIVERY.md §6) |
| **Own delivery in `shippingOptions`** (built on #841) and **`order.delivery`** (built on #858: state, steps, rider, handover code, and while picked up the position and `etaAt`) | api/DELIVERY.md §2 and §7 |
| **The order's delivery address and pin, and a courier's name, tracking number and link**: **not served; a card for the API** (decided on #866). `ShopOrder` carries no shipping address, pin or courier tracking, so the order screen has no "Deliver to" line and no "Track with" button, and the live map shows the rider alone | The order screen and the live map |
| **Payment for a native SDK**: what each provider's app checkout needs, for the app's `checkout`. **Stripe and PayPal built on #856, Razorpay, Cashfree and PhonePe on #857** (below) | The providers' sheets need these instead of the web element |

**Stripe and PayPal (#856).** `placeOrder` and `payOrder` take an optional `app: { scheme, stripeApiVersion }`; without it they
answer as they do for the website, and nothing else changes. `scheme` is the app's own URL scheme (`APP_SCHEME`, ../README.md §3),
checked for shape only (a custom scheme, never `http`, `https`, `javascript` and the like); the API stores no scheme per store (decided on #856; the card's "validated against the store's configured scheme" needs a per-store setting no card has built). The risk: a caller can name another app's scheme, and that app then receives the order id in the return link, which alone opens nothing (an order reads only with its session or cart token). A per-store scheme setting would close it.
The answer is `ShopPaymentStart`:

| Provider | Answer for the app |
|---|---|
| **Stripe** | `clientSecret` of the PaymentIntent on the merchant's connected account, `publicKey` and `accountId` (the sheet's `publishableKey` and `stripeAccountId`). For a signed-in shopper that also names `customerId` (their Customer on the connected account, found by `metadata[df_customer_id]` or made, with nothing else of theirs sent) and `ephemeralKeySecret`, made for the `stripeApiVersion` the app's SDK speaks; without that version, or for a guest, there are no saved cards and neither is set |
| **PayPal** | `providerRef` (the Orders v2 order id) and `redirectUrl`, PayPal's approval page, created with return URL `<scheme>://orders/<orderId>` and cancel URL `<scheme>://checkout`. The app opens it in the in-app browser, and on the return it reads the order |

**Razorpay, Cashfree and PhonePe (#857).** The same `app` input; the Indian providers need only `scheme` to be accepted, and use none
of it (their SDKs return to the app by themselves). Every `ShopPaymentStart` now also answers `amount` (what is due now, the engine's
`amountDue` less any gift card) and `mode` (`test` or `live`, the storefront's), filled by the checkout whatever the provider:

| Provider | Answer for the app |
|---|---|
| **Razorpay** | `providerRef` (the Razorpay order id), `publicKey` (the key id), `amount` and `mode`: what `RazorpayCheckout.open` takes as `order_id`, `key`, `amount` and `currency` |
| **Cashfree** | `sessionId` (the payment session id), `providerRef` (the order id) and `mode`, which is the SDK's environment (`test` is `SANDBOX`, `live` is `PRODUCTION`): what `CFSession` takes. Still `PHONE_REQUIRED` until the cart has a mobile number |
| **PhonePe** | `providerOrderId` (PhonePe's own order id), `token` (the order token) and `publicKey` (the merchant id), for the SDK's `init` and `startTransaction`. For an app the order is PhonePe's SDK order (`POST /payments/v2/sdk/order`, `paymentFlow` `PG`), not the website's payment page; `providerRef` is our own reference, which the status read-back and the webhook use. Rupees only |

PhonePe's SDK needs the merchant ID PhonePe issues at onboarding, which is not the client ID and which no API call returns, so Payment
setup takes it as an optional key (`merchantId`, THIRD-PARTY-ACCESS §3.1). A store without it answers `METHOD_UNAVAILABLE` for the app
and still takes PhonePe on the website. The Store portal's and the merchant app's forms have no field for it yet: a card of its own
(decided on #857). The order token is the one short-lived value an answer holds for PhonePe, made by PhonePe for the client; no client
secret, webhook password or key is ever in an answer or a log. Each provider's order is made with our attempt id as its reference
(Cashfree also as `x-idempotency-key`), with the adapters' timeout.

The ephemeral key's secret is the one short-lived secret an answer holds for Stripe, and Stripe made it for the client; no secret key or
webhook secret is ever in an answer. The amount is the engine's `amountDue`, the same as the website's for the same cart. Payment
is confirmed only by the providers' webhooks (and, as on the website, by `confirmPayment` reading the provider back on the
return); the app never marks an order paid.
