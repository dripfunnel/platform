# mobile-app/merchant: React Native with Expo

The technology decisions for the merchant mobile app, which is the merchant portal as a native
iOS and Android app in each partner's look:

- why React Native, and why Expo rather than bare React Native;
- why it shares no code with the web apps;
- how it signs in, how it formats money and dates, and which Expo SDK it runs on.

How builds, partners and store accounts work is in
[BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: decided, not built.** No app folder or code yet.

Last updated: 2026-10-09 (#493: no shared code with the SPAs).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **React Native with Expo** for the merchant mobile app (decided 2026-10-08) | Flutter; bare React Native without a framework; separate native apps (Swift and Kotlin); the web portal wrapped in a web view | Same language, React and toolchain as the rest of the platform, typed from the same `apps/api/schema/` (§2). React Native's own docs recommend a framework and name Expo, and Expo turns "one build per partner" into configuration instead of native file edits (§3). Flutter's strengths matter little for a portal of forms, lists and dashboards (§4). |
| **The app signs in with the portal's own session, carried as a bearer token** (decided 2026-10-08, §5) | Keeping the portal's cookie in the app | The app would have to fake `Origin` on every write to pass the CSRF check, and the cookie would sit outside the phone's secure storage. A token in secure storage, on the same `user_session` row, changes nothing else about sessions. |
| **Hermes, with FormatJS polyfills filling the gaps in its `Intl`** (decided 2026-10-08, §6) | Switching to JavaScriptCore; writing the app's `src/format/` on a date or number library | Hermes is React Native's and Expo's default engine. FormatJS is pure JavaScript, works the same on Android and iOS, and replaces only what Hermes lacks, so `src/format/` is written on standard `Intl`. |
| **No shared code.** The app imports nothing from `apps/ui/shared` (`@dripfunnel/shared`) or `apps/ui/store`. It has its own API client, formatting, messages and validation, typed only from `apps/api/schema/`. Nothing moves into `shared/` for it (decided 2026-10-09, §2) | Reusing `@dripfunnel/shared` and moving code from `apps/ui/store` into `shared/` | Decided on #493. The cost is that the app writes and keeps its own versions of those parts (§2). |
| **Start on the current Expo SDK; take patch updates on a schedule, and a new SDK only when it improves the app** (decided 2026-10-08, §3) | Following every new SDK as it ships | Every new Expo SDK can break things; patch updates within an SDK don't. A new SDK is worth that work only for a real gain, such as performance. |
| **The app will live in this repo**, at `apps/ui/mobile-app/merchant`, inside the pnpm workspace and the turbo gates | A separate mobile repo | One repo is the platform's rule (ARCHITECTURE.md §1): a change can go from the GraphQL schema to the mobile screen in one pull request. The pull request that scaffolds the app adds it to ARCHITECTURE.md §1–§3. The `dev` and `prod` pipelines don't deploy it; its builds and submissions are manual ([BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md) §2). |

---

## 2. Nothing is reused

The app shares no code with the SPAs (decided 2026-10-09, §1). It imports nothing from
`@dripfunnel/shared` or `apps/ui/store`, and nothing moves into `apps/ui/shared/` for it.

The app writes its own:

- **API client** (`src/graphql/`), against `https://<portal host>/api/` with the bearer token (§5);
- **formatting** (`src/format/`): money, dates, numbers, plurals, on Hermes (§6);
- **auth**: the session from the bearer token (§5);
- **validation** (zod) and **messages** (`messages/`);
- **brand loading**: the brand query turned into a React Native theme, with values that match the
  `--df-*` tokens.

Its only link to the rest of the repo is its types, generated from `apps/api/schema/`
(ARCHITECTURE.md §3).

---

## 3. Why Expo

- **Per-partner builds from configuration.** `app.config.ts` reads the partner's portal domain,
  app name, bundle id, icon and splash at build time, and each partner is a build profile
  ([BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md) §2).
- **Builds and submits to many store accounts.** EAS Build and EAS Submit keep each partner's
  signing credentials and store keys separate.
- **Over-the-air fixes.** EAS Update can push a JavaScript fix to every partner's app without a
  store release. Apple allows this only when the update doesn't change the app's primary purpose
  (App Review Guideline 2.5.2), so new features still go through review.
- **No Mac needed.** iOS builds run in EAS's cloud, so the team can build and ship from Windows.

**Why Expo instead of bare React Native** (decided 2026-10-08):

React Native's own documentation recommends a framework, and names Expo
([reactnative.dev, "Get started"](https://reactnative.dev/docs/environment-setup), checked
2026-10-08):

> "most developers benefit from using a React Native Framework like Expo. Expo provides features
> like file-based routing, high-quality universal libraries, and the ability to write plugins
> that modify native code without having to manage native files."

Without a framework, the same page warns, "you'll either have to write your own solutions to
implement core features, or you'll have to piece together a collection of pre-existing
libraries to create a skeleton of a Framework." It recommends that path only for apps with
unusual constraints.

Expo is made by a third party (Expo, open source), not by the React Native team. That is what
the React Native team recommends, and it matters more for us than for most apps:

| Need | Bare React Native | Expo |
|---|---|---|
| **One build per partner** | The `ios/` and `android/` folders are committed and edited by hand in Xcode and Gradle. A partner's bundle id, name and icon mean native file changes per partner. | The native folders are generated from `app.config.ts` at build time. A partner is an env file, not native edits (CONFIGURATION.md). |
| **iOS builds from Windows** | Needs a Mac with Xcode, or our own macOS CI | EAS Build in the cloud |
| **Submitting to each partner's store accounts** | Our own fastlane scripts per partner | EAS Submit with per-partner credentials |
| **Over-the-air fixes** | Microsoft's CodePush was retired with App Center in 2025, so we would run our own | EAS Update, one channel per partner |
| **Navigation, secure storage, splash, localisation** | Choose, wire and upgrade each library ourselves | Expo Router and Expo's maintained modules, tested together per SDK |
| **Upgrading React Native** | By hand, through native diffs | One Expo SDK at a time, with an upgrade guide (see below) |

**Not a lock-in.** Custom native code is still possible through config plugins and development
builds. If we ever left Expo, `expo prebuild` writes out the native folders and the app carries
on as bare React Native.

**What it costs.** EAS's cloud services have a free tier with limits and paid plans above it.
Many partners and manual builds may need a paid plan; check the build count against the plan
before a busy release.

**SDK version and upgrades** (decided 2026-10-08):

- The app starts on the **current Expo SDK when it is scaffolded**: SDK 57 (`expo@57.0.27`) on
  2026-10-08. The version is pinned in the app's `package.json`.
- Every Expo SDK is its own major version (55, 56, 57…), tied to one React Native version.
  Updates within an SDK (57.0.x) are patches without breaking changes, and they are **taken on a
  schedule**.
- A **new SDK** can carry breaking changes. It is **not taken by default**, only when it improves
  the app, for example its performance. The upgrade is then its own card.
- **The stores can force a new SDK.** Google Play requires apps to target a recent Android API
  level every year, and Apple requires builds made with a recent Xcode and iOS SDK. An old Expo
  SDK can't meet those, and the stores then refuse updates to the app. Watch both deadlines and
  plan the new-SDK card before they arrive.

---

## 4. Why not the alternatives

| Alternative | What it would cost |
|---|---|
| **Flutter** | A second language (Dart) and a toolchain outside pnpm and turbo. GraphQL types regenerated with Dart codegen. Over-the-air updates only through a paid third party, and iOS builds need macOS CI. In return: smoother animations and pixel-identical rendering, which a merchant portal barely needs. |
| **Separate native apps (Swift, Kotlin)** | Two more codebases and two more languages, with every screen built three times. |
| **The web portal in a web view** | It feels like a website, gets no real native features (push, camera for barcodes), and risks rejection under App Review Guideline 4.2 (minimum functionality). The portal's cookie sessions don't carry into the app either. |

---

## 5. Native sign-in (decided 2026-10-08)

Portal sessions are `__Host-` cookies with an `Origin` check on every mutation (ACCESS.md §4).
A native app sends no `Origin` and keeps cookies outside the phone's secure storage, so the app
gets the **same session as a bearer token**:

- Sign-in, 2-factor, invitations and reset use the existing Store API routes on
  `https://<portal host>/api/`. The session comes back in the response body only to a request
  with **no `Origin` header and no session cookie**, which is what the app sends. Browsers
  always send `Origin` on a POST, so no web page can get a token, and no flag or header lets a
  client ask for one. These routes keep the sign-in rate limits. The rule lives in ACCESS.md §4.
- It is the same `user_session` row, so everything else in ACCESS.md §4 holds unchanged: the
  idle and absolute bounds, "Remember me", 2-factor, the store chooser, `X-Store` and
  `X-Supplier`, sign-out, "where you're signed in", a password change ending other sessions,
  and a session working only on its own partner's host.
- The app keeps the token in the phone's secure storage (Keychain or Keystore, through Expo
  SecureStore) and sends it as `Authorization: Bearer <token>`. It is never logged or shown.
- A request authenticated by a bearer token skips the `Origin` check, because a browser never
  attaches that header on its own, so there is nothing to forge. Cookie requests keep the check.
- **A bearer token is accepted only on a request with no session cookie**; a request carrying
  both is refused. The rule lives in ACCESS.md §4.
- No new table, endpoint or screen: the change is in the sign-in response and in how the API
  reads a session.

Only the screens that call the Store API wait for this to be built; the project setup and
loading the partner's look don't.

---

## 6. Formatting on Hermes (decided 2026-10-08)

Hermes builds `Intl` on the phone's own APIs, not the full ICU library browsers have, so parts
of the app's `src/format/` could fail or come out differently: `Intl.PluralRules` and
`Intl.ListFormat` have been missing, `NumberFormat`'s `unit` style is partial, and
`timeZoneName` may differ.

- **The app keeps Hermes and fills the gaps with FormatJS.** FormatJS is pure JavaScript, so it
  runs the same on Android and iOS with no native code or Expo config.
- At startup, before anything formats, the app loads each FormatJS polyfill through its
  `shouldPolyfill` check, so only what Hermes lacks is replaced. Locale data is loaded only for
  the languages the portal ships.
- `@formatjs/intl-datetimeformat` and its time-zone data are added only if the zone names fail
  the check below.
- **The check:** the card that sets up the app runs the inputs from the `src/format/` tests on
  Hermes on iOS and on Android and compares the output with Node's. Tests on Node don't prove
  Hermes. Currency digits in money formatting matter most: money is stored in minor units, so a
  wrong digit count stores a wrong price.

