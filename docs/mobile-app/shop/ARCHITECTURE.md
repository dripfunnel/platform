# mobile-app/shop: code architecture

How `apps/ui/mobile-app/shop` is laid out and how it talks to the Shop API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); builds and per-store configuration are
[../README.md](../README.md) §3.

**Status: the project is set up (#860); Home, Browse, search and the product page are built (#861); sign-in, register, reset, Account and addresses with a map pin are built (#862), and the cart and checkout with cash on delivery and bank transfer are built (#863), and so is paying with Stripe and PayPal (#864)**: `app.config.ts` reading `stores/<STORE_KEY>.env` (the `dev` store, host `dev.my-store.localhost`), `eas.json`'s `dev` profile, the Shop API client sending `X-Shop-Session` and `X-Shop-Cart` from secure storage, the store's name and logo at startup (the last look is saved on the device) and placeholder tabs for the screens still to come (SH 13, SH 14). Home, Browse (collections, filters, sort, Show more), search and the product page with add to cart read the catalogue through `features/catalogue/`; the last page each loaded is kept on the device so a phone with no signal shows it under a banner (§2).

Last updated: 2026-10-27 (#864: `checkout/payments/`, the two packages built, the Stripe plugin and `APPLE_PAY_MERCHANT_ID`, §2, §3). Before: 2026-10-27 (#858: the Shop API now answers `order.delivery` and registers customer and guest-order push devices, §4). Before: 2026-10-27 (#863: the cart and checkout, §2 and §4; `AddressFields` is shared by Account and checkout; the shared client knows the checkout's refusal codes). Before: 2026-10-26 (#862: sign-in, register, reset, Account and addresses with a native map pin, §2 and §3; the session is held by `ShopProvider`; Delete my account waits for a Shop API operation). Before: 2026-10-26 (#861: Home, browsing, search and the product page; the two dependencies they need, §3; the offline cache is capped, §2). Before: 2026-10-26 (#860: the project is set up; the client's extra headers, §2). Before: 2026-10-26 (#857: Razorpay, Cashfree and PhonePe for the app's native sheets, §4). Before: 2026-10-23 (#856: payment for the app's native sheets, Stripe and PayPal, built, §4). Before: 2026-10-23 (#855: the session and cart tokens need no change; the brand is `store`, without colours or font, §4). Before: 2026-10-22 (first version).

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
    features/<area>/        screens per area; catalogue/ holds Home, Browse, collection, search and the product page; account/ the sign-in, register, reset and Account screens; addresses/ the saved addresses and the pin (its country rules copy the website's, and `rules.parity.test.ts` fails when the two differ; `AddressFields` is the form and pin both Account and checkout use); cart/ the cart screen and the totals; checkout/ one screen that walks contact, address, delivery, payment and review, then the confirmation (`steps.ts` says where each refusal sends the shopper), and `payments/` for Stripe and PayPal (`stripe.ts` and `paypal.ts` open each provider's sheet, `settle.ts` is the bounded read until the order is paid, `pay.ts` is one attempt, `PayScreen.tsx` its states); common/ what they share (ui, fields, the load hooks, the offline cache, error words)
    api/<area>.ts           the app's GraphQL operations, typed from apps/api/schema/shop.graphql
    session/                the customer's session token and the cart token, in secure storage
    testing/                the fake Shop API and the renderer the screens' tests share
    brand/                  the store's look from the Shop API
    push/                   permission, the Expo token, opening the order a push names
    nav.ts  messages/
```

Foundations (`graphql/`, `format/`, `intl/`, `theme/`) come from `apps/ui/mobile-app/shared`
(../README.md §2). The shared client takes `extraHeaders`, read on every call, for the Shop API's
`X-Shop-Session` and `X-Shop-Cart` (#860). Built so far: the tokens are read from secure storage at start
(`session/tokens.ts`; the cart token is kept apart, under `<host>.cart`) and the writers come with sign-in and the
cart (SH 9, SH 10; the cart screen and checkout send the cart token on every call). `ShopProvider` holds the one client the screens call with and the session (`signedIn`, `startSession`, `endSession`: a sign-in keeps its token in secure storage and drops the guest cart token, whose cart the API has claimed for the account; sign-out asks the API to end the session and removes the token whatever the answer); `addToCart` and every cart write answer a guest's cart token, which `saveCartToken` keeps. `pnpm dev:shop` starts Expo's dev server for the `dev` store; the app's theme stays
DripFunnel's palette (§4: no colours served).

**Offline (#861).** Browsing keeps no cache layer of its own: each screen's first answer is saved in the device's storage under one slot (home, collections, a collection's products, a product), and served only to the same request, when the phone gets no answer (`NO_RESPONSE`). Product pages and collection pages are kept 20 at a time, the most recently loaded, so browsing many products cannot fill the device's storage. It shows under the "You're offline" banner; with nothing kept it shows the offline state. Search is never kept, and recent searches stay on the device and are never sent. A write (add to cart) is not offered while the page shown is a kept one.

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-notifications` | Order and delivery pushes |
| `expo-secure-store` | The session and cart tokens |
| `expo-location` | "Use my location" on the address pin (built on #862): asked only while the app is in use and only when the shopper taps for it; its geocoder also puts the pin where the typed address is, the way that needs no map (WCAG 2.2, 2.5.1). A pin is dropped by hand only on a map zoomed in to about a city |
| `react-native-maps` | The address pin (built on #862) and the live tracking map (Google Maps on Android, Apple Maps on iOS). Android takes its key from the store's optional `GOOGLE_MAPS_ANDROID_KEY` (../README.md §3) |
| `@stripe/stripe-react-native` | Stripe's Payment Sheet (built on #864, at the version Expo SDK 57 bundles, `0.64.0`). Set up only from the Shop API's answer (the connected account's key and id, the intent's secret, the shopper's customer and ephemeral key); the app holds no key and sends the SDK's own API version (`Constants.API_VERSIONS.CORE`) with `placeOrder` and `payOrder`. Its config plugin switches on Google Pay, and Apple Pay for a store whose file names `APPLE_PAY_MERCHANT_ID`; the Payment Sheet decides what it shows |
| `react-native-razorpay` | Razorpay's checkout |
| `react-native-cashfree-pg-sdk` | Cashfree's checkout |
| PhonePe's React Native SDK | PhonePe's checkout |
| `expo-video` | The product page's video (#861): a hosted file plays in the product gallery; a video that is only a link to a page opens with `Linking` instead |
| `react-native-gesture-handler` | Pinch to zoom on a product photo (#861), the same on iOS and Android, with a double tap and the screen reader's zoom action as the single-pointer way (WCAG 2.2, 2.5.1); React Native's own ScrollView zoom is iOS only. Callbacks run on the JS thread, so it needs no `react-native-reanimated` of its own |
| `expo-web-browser` | PayPal (built on #864), decided on #856: its approval page in the in-app browser (`openAuthSessionAsync`), which returns to the app's scheme. PayPal has no official React Native SDK, so the alternative was our own Expo module around its native SDK to build and keep up. The API side is the same Orders v2 order either way |

---

## 4. Shop API changes the app needs

| Change | Why |
|---|---|
| ~~A bearer token beside the cookie~~ **Nothing to build** (decided on #855, 2026-10-23): the Shop API has no cookie and checks no `Origin`. Sign-in answers the session token in the body (`sessionToken`) and the app sends it as `X-Shop-Session`; a guest's cart token comes from `addToCart` and goes back as `X-Shop-Cart` (ACCESS.md §2.1) | An app has no cookie jar, and needs none |
| **The store's brand**: **built as the Shop API's `store`**: name, description, logo, favicon (the app's mark), tagline, contact, social. Its **colours and font are not served**: `app_shop` has no grant on the colours (DATA-MODEL.md §7.8) and no font exists. The app has no per-store colours or font until a card adds them | The app's look at runtime (../README.md §3) |
| ~~**`registerPushDevice`, `unregisterPushDevice`** for a signed-in customer or a guest's order~~ **Built on #858**: `registerPushDevice(token, platform, orderId)` (a guest names the order and holds its token; a signed-in customer needs no `orderId`) and `unregisterPushDevice(token, orderId)`; the app unregisters before it signs out | Order pushes (api/DELIVERY.md §6) |
| **Own delivery in `shippingOptions`** (built on #841) and **`order.delivery`** (built on #858: state, steps, rider, handover code, and while picked up the position and `etaAt`) | api/DELIVERY.md §2 and §7 |
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
