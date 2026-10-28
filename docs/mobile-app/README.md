# mobile-app: the three apps

Which mobile apps the platform has, who gives each one to whom, and how each reaches the App
Store and Google Play. Each app's own folder holds its scope and code.

**Status:** the merchant app is being built (merchant/ARCHITECTURE.md); the shop app's project is
built through the cart and checkout, every payment method, orders, live delivery tracking and push notifications, with the store's languages, currencies and legal pages still to come (shop/ARCHITECTURE.md, #860 to #866); the delivery app is set up (#848), with its screens still to come (delivery/ARCHITECTURE.md).

Last updated: 2026-10-28 (#868: Settings › Mobile apps sets the three images and the listing text; the two background colours are not set there, §3). Before: 2026-10-28 (#867: `connection/`, whether the phone is online, moves into mobile-shared, §2). Before: 2026-10-27 (#848: the delivery app's project, and `brand/` moves into mobile-shared, §2). Before: 2026-10-27 (#866: the shop app's optional `EAS_PROJECT_ID` and `GOOGLE_SERVICES_FILE`, §3). Before: 2026-10-27 (#864: the shop app's optional `APPLE_PAY_MERCHANT_ID`, §3). Before: 2026-10-27 (#863: the shop app's status). Before: 2026-10-26 (#860: the shop app's project). Before: 2026-10-22 (the shop and delivery apps, with Gaurav; Enterprise only).

---

## 1. The apps

| App | Code | Given by → to | Built | Brand | Calls |
|---|---|---|---|---|---|
| **Merchant app** | `apps/ui/mobile-app/merchant` | Partner → its merchants and their vendors, to run their stores | One build per **partner** | The partner's | Store API on the partner's portal host ([merchant/](merchant/REACT-NATIVE.md)) |
| **Shop app** | `apps/ui/mobile-app/shop` | Merchant → its customers, to shop | One build per **store** | The store's | Shop API at `/shop-api/` on `{slug}.<SHOP_DOMAIN>` ([shop/](shop/FIRST-RELEASE.md)) |
| **Delivery app** | `apps/ui/mobile-app/delivery` | Merchant → its own delivery people (riders), to deliver orders from its warehouses to customers | One build per **store** | The store's | Delivery API at `/delivery-api/` on `{slug}.<SHOP_DOMAIN>` ([delivery/](delivery/FIRST-RELEASE.md), [api/DELIVERY.md](../api/DELIVERY.md)) |

---

## 2. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Three apps**: merchant, shop and delivery (decided 2026-10-22 with Gaurav) | A rider mode inside the merchant app | Each app has one audience. The shop and delivery apps are the merchant's to give, in the store's brand; the merchant app is the partner's. |
| **The shop and delivery apps are built per store, and published from the merchant's own Apple and Google developer accounts**, which DripFunnel operates as it does the partners' (merchant/BUILDS-AND-STORE-ACCOUNTS.md §2) *(proposed)* | Publishing every store's apps from the partner's or DripFunnel's account | The same rules as the merchant app, one level down: Apple rejects template apps a provider submits for its clients (4.2.6), both stores treat near-identical apps from one account as spam, and the listing must name the brand owner (merchant/BUILDS-AND-STORE-ACCOUNTS.md §3). One merchant account holds both of its apps, which do different jobs. |
| **The delivery app may be installed as an APK, with no app store** (decided 2026-10-22): a signed Android build per store, downloaded from a link in the rider's invitation text and in Settings › Riders. Nothing checks that it is in a store | Requiring Google Play or the App Store before own delivery | Riders are the merchant's own people, so they can be asked to install it directly, and own delivery needn't wait for an Apple or Google enrolment. The iOS build and a Play listing can follow. |
| **The shop app needs the merchant's own accounts; a store without them has no shop app** *(proposed)* | A shared picker app | As the merchant app's rule for partners. Its customers keep the storefront website. |
| **The apps are a plan setting**, `own_apps`, for **Enterprise** stores only, turned on by hand by DripFunnel staff (decided 2026-10-22; api/DELIVERY.md §9) | Every store gets them | Each store's apps cost DripFunnel a build, a review and upkeep. |
| **The app icon, splash and listing text are uploaded in the merchant portal**, Settings › Mobile apps (Owner) *(proposed)* | Asking each merchant for files outside the platform | As the partner's in the partner console (merchant/BUILDS-AND-STORE-ACCOUNTS.md §5): the build takes them from configuration. |
| **Builds, submissions and over-the-air updates are manual**, per store, as the merchant app's are per partner | Building on merge | Every submission is reviewed by Apple and Google and reaches people's phones. |
| **The shop and delivery apps share the merchant app's foundations through `apps/ui/mobile-app/shared`**, extracted when the shop app first needs them: the API client, `format/`, `intl/`, the theme and the session's secure storage. **Built in #853** as the workspace package `@dripfunnel/mobile-shared` (`graphql/`, `format/`, `intl/`, `theme/`, `storage/`, `connection/` from #867 (whether the phone is online), and `brand/` from #848: the store's name and logo from the Shop API, the saved look, `storeHost()` and the startup provider, to which an app passes its client and its error screen; the shop and delivery apps both use it), which an app imports by name; each app passes in what differs (the API's host and path such as `/api/`, the sign-out path, the brand's theme overrides, how its saved "last used" value is read) and keeps what is its own: the merchant app's PARTNER_DOMAIN, `Acting` and session store. An ESLint rule lets an app import only this package, and the package import no app | Copying them into each app | AGENTS.md "Code" rule 1: extract on the second use. The apps still share nothing with the SPAs (merchant/REACT-NATIVE.md §2). |

---

## 3. Per-store configuration

Each app keeps one file per store, `stores/<storeKey>.env`, read and validated by its
`app.config.ts` the way the merchant app's `partners/<partner>.env` is (merchant/CONFIGURATION.md §1):

| Variable | Example | Sets |
|---|---|---|
| `STORE_KEY` | `acme` | Picks the file, the EAS profile and the update channel; the store's slug |
| `STORE_HOST` | `acme.my-store.one` | The API host (`{slug}.<SHOP_DOMAIN>`, which never changes) |
| `APP_NAME` | `Acme` / `Acme Delivery` | The name under the icon |
| `IOS_BUNDLE_ID`, `ANDROID_PACKAGE` | `com.acme.shop` | Registered in the merchant's accounts |
| `APP_SCHEME` | `acmeshop` | Links that open the app |
| `ICON_IMAGE`, `ANDROID_ICON_FOREGROUND`, `SPLASH_IMAGE` | | The newest version of the store's images, which the Owner uploads in Settings › Mobile apps (**built on #868**; DATA-MODEL §3.7): the app icon and the Android foreground 1024 × 1024 PNG, the icon with no transparency, every file at most 512 KB. The listing text (app name up to 30, short description up to 80, full description up to 4000) is saved with them. Only for a store whose plan has `own_apps` |
| `ANDROID_ICON_BACKGROUND`, `SPLASH_BACKGROUND` | `#FFFFFF` | Not set in Settings › Mobile apps (decided on #868): whoever prepares the store's build sets them in its env file |
| `GOOGLE_MAPS_ANDROID_KEY` | `AIza…` | *Optional.* The Google Maps SDK for Android key for the address pin and tracking map: a public build value restricted to the app's package and signing certificate, never a secret (THIRD-PARTY-ACCESS §2.12; decided on #862). Without it the map is blank on Android |
| `EAS_PROJECT_ID` | `0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d` | *Optional, the shop app.* The store's own EAS project, which Expo's push service makes a push token for (api/DELIVERY.md §6): public. Without it the app never asks for notification permission or registers a phone, and every other screen works (decided on #866) |
| `GOOGLE_SERVICES_FILE` | `stores/acme/google-services.json` | *Optional, the shop app.* The store's Firebase client config, which Android needs to get a push token: a path under the store's own folder, like the images, checked to exist. Public client config, not a secret. Sending real pushes also needs the store's FCM and APNs credentials in EAS, which no file in this repository holds (decided on #866) |
| `APPLE_PAY_MERCHANT_ID` | `merchant.com.acme.shop` | *Optional, the shop app.* The store's Apple merchant identifier, from its Apple developer account: public, passed to Stripe's config plugin. Only a store that takes Apple Pay has one; without it the Payment Sheet offers no Apple Pay (decided on #864) |
| `UPDATES_CHANNEL` | `acme` | Equal to `STORE_KEY` |

Secrets (signing, the App Store Connect key, the Play service account, push credentials) live in
EAS's credential store per store, never in the repo, as merchant/CONFIGURATION.md §3 lists them.
The logo and wording are read at runtime from the store's brand on the Shop API (`store`); its colours and font are not served yet (shop/ARCHITECTURE.md §4).

---

## 4. Open questions

- *(decide)* One EAS project per app, or per store; the merchant app has one project for every
  partner.
