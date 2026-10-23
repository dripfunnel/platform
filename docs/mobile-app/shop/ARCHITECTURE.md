# mobile-app/shop: code architecture

How `apps/ui/mobile-app/shop` is laid out and how it talks to the Shop API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); builds and per-store configuration are
[../README.md](../README.md) §3.

**Status: specification, not built.**

Last updated: 2026-10-23 (#856: payment for the app's native sheets, Stripe and PayPal, built, §4). Before: 2026-10-23 (#855: the session and cart tokens need no change; the brand is `store`, without colours or font, §4). Before: 2026-10-22 (first version).

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
      (tabs)/               home  browse/  cart  account/
      product/[handle]  checkout/  orders/[id]  orders/[id]/track
    features/<area>/        screens per area
    api/<area>.ts           the app's GraphQL operations, typed from apps/api/schema/shop.graphql
    session/                the customer's session token and the cart token, in secure storage
    brand/                  the store's look from the Shop API
    push/                   permission, the Expo token, opening the order a push names
    nav.ts  messages/
```

Foundations (`graphql/`, `format/`, `intl/`, `theme/`) come from `apps/ui/mobile-app/shared`
(../README.md §2).

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-notifications` | Order and delivery pushes |
| `expo-secure-store` | The session and cart tokens |
| `expo-location` | "Use my location" on the address pin |
| `react-native-maps` | The address pin and the live tracking map (Google Maps on Android, Apple Maps on iOS) |
| `@stripe/stripe-react-native` | Stripe's Payment Sheet |
| `react-native-razorpay` | Razorpay's checkout |
| `react-native-cashfree-pg-sdk` | Cashfree's checkout |
| PhonePe's React Native SDK | PhonePe's checkout |
| `expo-web-browser` | PayPal, decided on #856: its approval page in the in-app browser (`openAuthSessionAsync`), which returns to the app's scheme. PayPal has no official React Native SDK, so the alternative was our own Expo module around its native SDK to build and keep up. The API side is the same Orders v2 order either way |

---

## 4. Shop API changes the app needs

| Change | Why |
|---|---|
| ~~A bearer token beside the cookie~~ **Nothing to build** (decided on #855, 2026-10-23): the Shop API has no cookie and checks no `Origin`. Sign-in answers the session token in the body (`sessionToken`) and the app sends it as `X-Shop-Session`; a guest's cart token comes from `addToCart` and goes back as `X-Shop-Cart` (ACCESS.md §2.1) | An app has no cookie jar, and needs none |
| **The store's brand**: **built as the Shop API's `store`**: name, description, logo, favicon (the app's mark), tagline, contact, social. Its **colours and font are not served**: `app_shop` has no grant on the colours (DATA-MODEL.md §7.8) and no font exists. The app has no per-store colours or font until a card adds them | The app's look at runtime (../README.md §3) |
| **`registerPushDevice`, `unregisterPushDevice`** for a signed-in customer or a guest's order | Order pushes (api/DELIVERY.md §6) |
| **Own delivery in `shippingOptions`** and **`order.delivery`** | api/DELIVERY.md §2 and §7 |
| **Payment for a native SDK**: what each provider's app checkout needs, for the app's `checkout`. **Stripe and PayPal built on #856** (below); Razorpay's order id, Cashfree's payment session and PhonePe's order token come with SH 4 | The providers' sheets need these instead of the web element |

**Stripe and PayPal (#856).** `placeOrder` and `payOrder` take an optional `app: { scheme, stripeApiVersion }`; without it they
answer as they do for the website, and nothing else changes. `scheme` is the app's own URL scheme (`APP_SCHEME`, ../README.md §3),
checked for shape only (a custom scheme, never `http`, `https`, `javascript` and the like); the API stores no scheme per store (decided on #856; the card's "validated against the store's configured scheme" needs a per-store setting no card has built). The risk: a caller can name another app's scheme, and that app then receives the order id in the return link, which alone opens nothing (an order reads only with its session or cart token). A per-store scheme setting would close it.
The answer is `ShopPaymentStart`:

| Provider | Answer for the app |
|---|---|
| **Stripe** | `clientSecret` of the PaymentIntent on the merchant's connected account, `publicKey` and `accountId` (the sheet's `publishableKey` and `stripeAccountId`). For a signed-in shopper that also names `customerId` (their Customer on the connected account, found by `metadata[df_customer_id]` or made, with nothing else of theirs sent) and `ephemeralKeySecret`, made for the `stripeApiVersion` the app's SDK speaks; without that version, or for a guest, there are no saved cards and neither is set |
| **PayPal** | `providerRef` (the Orders v2 order id) and `redirectUrl`, PayPal's approval page, created with return URL `<scheme>://orders/<orderId>` and cancel URL `<scheme>://checkout`. The app opens it in the in-app browser, and on the return it reads the order |

The ephemeral key's secret is the one short-lived secret an answer holds, and Stripe made it for the client; no secret key or
webhook secret is ever in an answer. The amount is the engine's `amountDue`, the same as the website's for the same cart. Payment
is confirmed only by the providers' webhooks (and, as on the website, by `confirmPayment` reading the provider back on the
return); the app never marks an order paid.
