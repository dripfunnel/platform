# mobile-app/shop: before building a store's app

What to prepare once per store, the files that make a store's build, and the checks to run before
every build and submission. Builds and submissions are manual, one store at a time
([../README.md](../README.md) §2; the merchant app's [BUILDS-AND-STORE-ACCOUNTS.md](../merchant/BUILDS-AND-STORE-ACCOUNTS.md)
§2 explains why). The variables are in [../README.md](../README.md) §3, the code in [ARCHITECTURE.md](ARCHITECTURE.md),
and the screens in [FIRST-RELEASE.md](FIRST-RELEASE.md).

**Status: written on #869 (SH 16) before the first build. Nothing here has been run against a real store's accounts yet; the pilot
store's first build confirms or corrects it, and each step that does is noted on the card.**

Last updated: 2026-10-28 (#876: the Firebase step). Before: 2026-10-28 (#869: first version).

---

## 1. Decisions recorded on #869

| Decision | Rejected | Why |
|---|---|---|
| **One EAS project per store** (decided on #869, 2026-10-28), created in an Expo organization made for that store, with DripFunnel's build operators as its members. Its id is the store file's `EAS_PROJECT_ID` | One project for every store, with a profile per store as the merchant app has one project for every partner | Expo's push service makes each phone's token for one project, and `EAS_PROJECT_ID` is already the store's own (../README.md §3). Each store's signing credentials, App Store Connect key, Play service account and push keys then sit apart, so one merchant's keys are never in reach of a build for another (AGENTS.md "Security", least privilege), and a merchant that leaves takes its project with it. The cost is one project and two `eas.json` profiles per store, a step in §2 and §3 |
| **Reviewers sign in with a demo customer that has an email and a password** (decided on #869, 2026-10-28) | A fixed review-only code that works for one named number | Apple (guideline 2.1) and Google need a working account they can use without receiving a text. A demo account is an ordinary customer, so it needs no change to `apps/api` and leaves every real customer's code untouched; a review-only code path would be a standing way round the sign-in code and would need its own API card and security review. For a store that takes mobile codes only, the merchant switches Settings › Customer accounts to **Both** for the review (customers who have only a number keep their accounts and can still sign in by code), as §6 says. The delivery app's riders have no password, so this does not settle theirs (delivery/ARCHITECTURE.md §4; DL 15) |
| **The store's images and listing text are copied into the repo by hand** from the newest version saved in Settings › Mobile apps (#868) | A build that fetches them from the platform | The Owner's tab previews them but offers no download, and a build reads only what is committed (../README.md §3). A script that reads the newest `store_app_assets` row from R2 would be its own card; until then §3 says how a person copies them |
| **Preview builds have a channel of their own** (`<store>-preview`) | The store's channel, which `UPDATES_CHANNEL` names | An over-the-air update published to a store's channel must never reach a phone that only has a preview |

---

## 2. Once per store

Before the store's first build (the Android map key is the one step that has to wait for it: §2a):

- [ ] The store's plan has `own_apps` (SAAS §6.1), and its Owner has uploaded the **app icon**, the **Android icon foreground** and the
      **splash**, and saved the **app name** and listing text, in Settings › Mobile apps (#868).
- [ ] The merchant has enrolled as an **organization** with the Apple Developer Program and Google Play Console, and has given
      DripFunnel access with the least role that lets it build, sign and submit: an App Store Connect API key at the smallest role
      that can upload builds, and a Play Console service account with only the permissions to release to the app. (merchant/BUILDS-AND-STORE-ACCOUNTS.md §2, §5;
      THIRD-PARTY-ACCESS §3.7.) **A store without both accounts gets no app yet**: its customers use the website.
- [ ] The **bundle id** (`IOS_BUNDLE_ID`) is registered in the merchant's Apple account and the app is created in App Store
      Connect; the **package name** (`ANDROID_PACKAGE`) is registered by creating the app in Play Console. Both are the store's own,
      chosen once and never changed after release.
- [ ] The store's **EAS project** exists (§1) and its id is in the store file. Each secret in THIRD-PARTY-ACCESS §3.7 is in that
      project's credential store, never in the repo.
- [ ] **Push** (only if the store wants notifications, since without `EAS_PROJECT_ID` the app never asks and every other screen works): a Firebase
      project for the store, its `google-services.json` committed under `stores/<key>/` (public client config), its FCM v1 service
      account key and the merchant's APNs key in EAS (api/DELIVERY.md §6).
- [ ] **Crash reports** (only if the store wants them; they are on only when **both** files below are present): the store's Firebase project has an Android app (the package) **and** an iOS app (the bundle id), with Crashlytics switched on, and both client files are committed under `stores/<key>/` (`google-services.json`, `GoogleService-Info.plist`), named by `GOOGLE_SERVICES_FILE` and `GOOGLE_SERVICE_INFO_FILE`. Push uses only the Android file. They are public client config, not secrets, and the same Firebase project serves push and Crashlytics. (mobile-app/README.md §3; shop/ARCHITECTURE.md §3.)
- [ ] **Apple Pay** (only if the store takes it): the Apple merchant identifier is made in the merchant's Apple account and named as
      `APPLE_PAY_MERCHANT_ID`; without it the Payment Sheet offers no Apple Pay.
- [ ] **The store's website and its Shop API answer** on `STORE_HOST` (`{slug}.<SHOP_DOMAIN>`, which never changes), and the store has
      products, a payment method the app can complete (README: every provider's native SDK) and, for a rider's tracking, own delivery
      switched on if it sells that way.

## 2a. After the first Android build: the map key

The Android map key (`GOOGLE_MAPS_ANDROID_KEY`) is restricted to the package **and the signing certificate** (THIRD-PARTY-ACCESS §2.12), and the certificate does not exist
until EAS makes the Android keystore at the first Android build. So the first Android build has **no map**, and that is expected:

- [ ] After the first Android build, read the keystore's SHA-1 (`eas credentials`), make the key restricted to the store's package and that SHA-1, and put it in `stores/<key>.env`.
- [ ] Build the preview again (§5): **the Android map check is done on that second build**, not the first.
- [ ] Once the app is in Play Console, add the SHA-1 of the **Play app signing key** to the same key (Play Console › App integrity), since Google signs what the store delivers; check the map on the internal-testing build.

---

## 3. Files to add for a store

Only these files change. **Nothing in `src/` changes for a store**: if a store seems to need a code change, stop and ask, because
per-store behaviour in code breaks ARCHITECTURE.md §1.

| File | What to put in it | Check |
|---|---|---|
| `stores/<key>.env` | Every variable in ../README.md §3: the store's key and host, the name under the icon (up to 30), the bundle id and package, the scheme, the image paths and the two background colours, `UPDATES_CHANNEL` equal to `STORE_KEY`, and, where used, the Maps key, the Apple merchant id and the EAS project id | `STORE_KEY=<key> npx expo config` prints them and fails on a missing value or file (§4 step 3) |
| `stores/<key>/icon.png` | The app icon | 1024 × 1024 PNG, **no transparency** and no rounded corners (the stores round them) |
| `stores/<key>/icon-foreground.png` | The Android adaptive icon foreground | 1024 × 1024 PNG, transparent background, the mark inside the middle two thirds (Android crops the rest) |
| `stores/<key>/splash.png` | The splash image | PNG, transparent background, the mark in the middle; it must look right on `SPLASH_BACKGROUND` |
| `stores/<key>/google-services.json` | The Firebase client config for Android, **only for a store with push or crash reports** | Named by `GOOGLE_SERVICES_FILE`; public, not a secret |
| `stores/<key>/GoogleService-Info.plist` | The same project's iOS client config, **only for a store with crash reports**, which need this and the Android file | Named by `GOOGLE_SERVICE_INFO_FILE`; public, not a secret; `expo config` fails on one without the Android file |
| `stores/<key>/listing/` | The store listing: name, short and full description (as saved in Settings › Mobile apps), screenshots, the privacy and data-safety answers (§6) and the reviewer's demo account **by name only** (§6) | Matches the store's name and look; no DripFunnel name, since the apps carry only the store's brand (FIRST-RELEASE §1) |
| `eas.json` | Two profiles for the store, below, and a submit profile | Each reads `stores/<key>.env` through `STORE_KEY` |

```json
{
  "build": {
    "<key>-preview": { "distribution": "internal", "channel": "<key>-preview", "android": { "buildType": "apk" }, "env": { "STORE_KEY": "<key>" } },
    "<key>": { "channel": "<key>", "autoIncrement": true, "env": { "STORE_KEY": "<key>" } }
  },
  "submit": {
    "<key>": { "ios": { "ascAppId": "<the app's id in App Store Connect>" }, "android": { "track": "internal" } }
  }
}
```

`appVersionSource` is already `remote`, so EAS keeps the build number. A change to the app's own source is released to every store by
building every store's profile again; only a JavaScript-only change may go as an update (§7).

**Getting the images.** Until a script exists, a person reads the newest row of `store_app_assets` for the store (DATA-MODEL §3.7), downloads its three keys from the assets
bucket (they sit under `stores/{store id}/app/`), and saves them under the names above; then checks each against the table. The listing text is the same row's
`app_name`, `short_description` and `long_description`.

---

## 4. Before every build

1. [ ] **Gates pass** on the commit you're building: `pnpm turbo run build typecheck lint test`.
2. [ ] **The images are current**: compare `stores/<key>/` with the newest saved version (§3), and check them against the table there.
3. [ ] **Configuration resolves**: run `STORE_KEY=<key> npx expo config`. It prints the store's name, bundle id, package, scheme and host, and fails on a missing value
       or a file that isn't there (`app.config.ts` checks every image and the Firebase file exist, and that none belongs to another store).
4. [ ] **The Shop API answers**: the `store` query on `STORE_HOST` returns the store's name and logo.
5. [ ] **Version**: a store release bumps `version` in `app.config.ts` (shared by every store); EAS increments the build number.
6. [ ] **Store rules**: the Expo SDK still meets Apple's current Xcode and Google's target API level requirements. Before a store's first submission, re-read the guideline text in
       merchant/BUILDS-AND-STORE-ACCOUNTS.md §3 and the two store-wide rules in §6 below.
7. [ ] **The first release is whole** (FIRST-RELEASE.md §2): **Delete my account is not built** (FIRST-RELEASE §2, "Getting in"), and **both stores require an in-app way to delete an account**
       (Apple 5.1.1(v); Google Play's account-deletion policy). **The app cannot be submitted until it exists**: it needs its own card for the Shop API operation and the screen. Check that card is done, or the build stops at TestFlight and
       internal testing.
8. [ ] **After an Expo SDK change**: the `Intl` check on Hermes has passed (merchant/REACT-NATIVE.md §6).

---

## 5. Try a preview build on a real phone

Build the store's preview profile and install it on one iPhone and one Android phone. **The first preview build yields the Android signing certificate (§2a); the map check on Android is done on a second one.** Three payment SDKs and the push module are native, so Expo Go cannot show them: a preview or development build is what proves every screen.

```bash
eas build --profile <key>-preview --platform all
```

- [ ] The name under the icon, the icon and the splash are the store's.
- [ ] The store's name and logo load on the first screen; no DripFunnel name or logo appears anywhere (FIRST-RELEASE §1).
- [ ] **Home, Browse, search and a product page** show the store's catalogue, its prices with the tax line and its stock wording.
- [ ] **Sign-in, register and reset** work by the methods the store has chosen; **Account** shows the profile, addresses and orders.
- [ ] **An address with a pin**: "Use my location" asks for permission only when tapped; the map shows on the iPhone (Apple Maps needs no key). **On Android the first preview build has no map** (its key waits for this build's signing certificate, §2a): check the map on the second preview build, after the key is in the store file.
- [ ] **Cart and checkout** with an offer code, a delivery option and **every payment method the store offers**, each in the provider's sandbox: cash on delivery, bank transfer, Stripe, PayPal, Razorpay, Cashfree, PhonePe.
- [ ] **Orders**: the list, an order, and **tracking** with a rider (position, handover code) if the store has own delivery.
- [ ] **Crash reports** (a store with both Firebase files): **the first preview build with them also proves the iOS build links**, since the Firebase pods are built as dynamic frameworks beside Stripe, Razorpay, Cashfree and PhonePe: if it does not, stop and say so on the card. Then force a crash (Firebase's own "test crash" in the console, or a throw from a screen on a scratch branch) and see it appear in the store's Crashlytics **with no name, email, phone, address, cart or amount in it**, and the customer's opaque id or none for a guest. Reports are off in a development build.
- [ ] **Push** (a store with `EAS_PROJECT_ID`): the offer appears after the first order, never at launch; a push opens that order's tracking.
- [ ] **Language and currency** switch, **Legal** pages open in the in-app browser, and the **offline banner** shows with the connection off and turns the buttons that write off.
- [ ] Money, dates and counts are in the store's settings and time zone.

Attach a screenshot of each to the card.

---

## 6. Build and submit

By hand, one store at a time:

```bash
eas build --profile <key> --platform all
eas submit --profile <key> --platform ios --latest
eas submit --profile <key> --platform android --latest
```

**TestFlight and Google Play internal testing first.** A new app's **first** Android build is uploaded by hand in Play Console (Google's API takes uploads for an app that already
has one); `eas submit` carries every build after it. Public release is after the pilot.

**The listing**, entered by hand in App Store Connect and Play Console from `stores/<key>/listing/`:

- **Apple App Privacy** and **Google Play Data safety**, answered as the store's seller of record (the merchant answers for them, merchant/BUILDS-AND-STORE-ACCOUNTS.md §5). What the app collects:
  name, email and phone (the account); delivery addresses and **precise location, only when the shopper taps "Use my location" on a pin**; order and purchase history;
  a **push token** (a device identifier), only for a store with push; **crash logs, the device model and system version, and the customer's opaque id**, only for a store with crash reports (Firebase Crashlytics, the store's own project; never a name, email, phone, address or order); payment is made in each provider's own sheet and **the app never holds a card number**. Nothing is used to track people across other companies' apps or sites.
- **Account deletion**: the in-app route (§4 step 7) and, for Google Play, the web address that explains it.
- **Reviewer's sign-in** (decided §1): in the review notes, a demo customer's **email and password** made by the merchant for this (an ordinary account, never a staff or Owner login), and how to reach checkout
  without a real payment. **For a store that takes mobile codes only, switch Settings › Customer accounts to "Both" before submitting and back after approval**, and say so in the notes. The credentials are written in the console and in no file of the repo;
  the listing folder records only that they exist and when they were last checked.
- **Location**: only while using the app, for the address pin (`NSLocationWhenInUseUsageDescription` and the Android coarse and fine location, in the store's words).

**Record the result on the card**: each build's number, each submission's status, what the reviewer asked, and what a person did to answer it.

---

## 7. Over-the-air updates

A JavaScript-only change that keeps the app's purpose (the rules in merchant/REACT-NATIVE.md §3) is published by hand to one store's channel, never to a preview's:

```bash
eas update --channel <key> --message "<what changed>"
```

`runtimeVersion` follows the app's `version`, so a change to a native module, the SDK or a config plugin needs a new build and a new store release, not an update.
