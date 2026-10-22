# mobile-app: the three apps

Which mobile apps the platform has, who gives each one to whom, and how each reaches the App
Store and Google Play. Each app's own folder holds its scope and code.

**Status:** the merchant app is being built (merchant/ARCHITECTURE.md); the shop and delivery
apps are specified, not built.

Last updated: 2026-10-22 (the shop and delivery apps, with Gaurav; Enterprise only).

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
| **The shop and delivery apps share the merchant app's foundations through `apps/ui/mobile-app/shared`**, extracted when the shop app first needs them: the API client, `format/`, `intl/`, the theme and the session's secure storage *(proposed)* | Copying them into each app | AGENTS.md "Code" rule 1: extract on the second use. The apps still share nothing with the SPAs (merchant/REACT-NATIVE.md §2). |

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
| `ICON_IMAGE`, `ANDROID_ICON_FOREGROUND`, `ANDROID_ICON_BACKGROUND`, `SPLASH_IMAGE`, `SPLASH_BACKGROUND` | | From Settings › Mobile apps |
| `UPDATES_CHANNEL` | `acme` | Equal to `STORE_KEY` |

Secrets (signing, the App Store Connect key, the Play service account, push credentials) live in
EAS's credential store per store, never in the repo, as merchant/CONFIGURATION.md §3 lists them.
Colours, logo, font and wording are read at runtime from the store's brand on the Shop API.

---

## 4. Open questions

- *(decide)* One EAS project per app, or per store; the merchant app has one project for every
  partner.
