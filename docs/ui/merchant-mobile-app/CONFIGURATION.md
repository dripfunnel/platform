# ui/merchant-mobile-app: per-partner configuration

Every value that differs between partners' apps, where it is kept, and what reads it. Why each
partner gets its own build is in [BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md);
the code that reads these values is in [ARCHITECTURE.md](ARCHITECTURE.md).

**Status: proposed, not built.**

Last updated: 2026-10-08.

---

## 1. Rules

- **One environment file per partner**: `apps/ui/merchant-mobile-app/partners/<partner>.env`.
  It is committed and holds **public values only**, because everything in it can end up in the
  app bundle. The build picks a file by its EAS build profile, one profile per partner.
- **`.env.example`** (committed, dummy values) lists every variable; **`.env.local`**
  (gitignored) holds your local values. This follows the repo rule in
  [code/THIRD-PARTY-ACCESS.md](../../code/THIRD-PARTY-ACCESS.md) §8.
- **Secrets never go in an env file** (§3). They live in EAS's credential store, per partner.
- **`app.config.ts` validates every value with zod** and fails the build on a missing or
  malformed one, so a partner's app can never ship with another partner's or a blank value.
- **Only `PARTNER_DOMAIN` reaches the running app**, through `expo-constants` `extra`. Every
  other value is used only by the build. No variable uses the `EXPO_PUBLIC_` prefix, so
  nothing reaches the bundle by accident.
- A variable is added to `.env.example`, to §2 below and to THIRD-PARTY-ACCESS.md §8 in the
  change that first reads it.

---

## 2. Variables per partner (`partners/<partner>.env`)

| Variable | Example | What it sets | Where the value comes from |
|---|---|---|---|
| `PARTNER_KEY` | `northstar` | The partner's id in the build: picks this file, the EAS profile and the update channel | Chosen once when the partner's app is set up |
| `PARTNER_DOMAIN` | `store.northstar.com` | The portal host: the API at `https://<domain>/api/`, the brand query, deep links | The partner's live portal host (SAAS.md §3.5) |
| `APP_NAME` | `Northstar Shops` | The name under the icon | The partner's product name (SAAS.md §3.4) |
| `IOS_BUNDLE_ID` | `com.northstar.shops` | iOS bundle id | Registered in the partner's Apple account |
| `ANDROID_PACKAGE` | `com.northstar.shops` | Android package name | Registered in the partner's Play Console |
| `APP_SCHEME` | `northstarshops` | The app's own URL scheme, for links that open the app | Chosen once; unique per partner |
| `ICON_IMAGE` | `partners/northstar/icon.png` | App icon (1024 × 1024) | The app-icon upload on the partner console's branding screen (BUILDS-AND-STORE-ACCOUNTS.md §5) |
| `ANDROID_ICON_FOREGROUND` | `partners/northstar/icon-foreground.png` | Android adaptive icon foreground | Same upload |
| `ANDROID_ICON_BACKGROUND` | `#0A2A4A` | Android adaptive icon background colour | The partner's primary colour (`partner_branding`) |
| `SPLASH_IMAGE` | `partners/northstar/splash.png` | Splash screen image | The splash upload on the branding screen |
| `SPLASH_BACKGROUND` | `#FDFAF7` | Splash background colour | `partner_branding` |
| `UPDATES_CHANNEL` | `northstar` | The EAS Update channel, so an over-the-air update reaches only this partner's app | Equal to `PARTNER_KEY` |

Images are downloaded from `partner_branding` into `partners/<partner>/` before a build. The
store listing's text and screenshots are kept in the same folder and entered by hand
(BUILDS-AND-STORE-ACCOUNTS.md §2).

**Not per partner** (shared by every build): the EAS project id, the app version, and the
build number, which EAS increments per store.

**Never in this file**: colours, logo, fonts, wording and the support contact. The app reads
those at runtime from the brand query, so a rebrand needs no new build
(BUILDS-AND-STORE-ACCOUNTS.md §2).

---

## 3. Secrets per partner (EAS credential store, never in the repo)

| Secret | What it is for | Who provides it |
|---|---|---|
| App Store Connect API key (`.p8`, key id, issuer id) | Submitting to the partner's Apple account | The partner, from its App Store Connect, at the least role (BUILDS-AND-STORE-ACCOUNTS.md §5) |
| iOS distribution certificate and provisioning profile | Signing the iOS app | Made by EAS in the partner's Apple account |
| Android upload keystore | Signing the Android app | Made by EAS, one per partner; kept for the app's life |
| Google Play service account key (JSON) | Submitting to the partner's Play Console | The partner, from its Google Cloud project, with only the Play permissions needed |
| Push credentials (APNs key; Firebase `google-services.json`) | Push notifications, when the app adds them | The partner's Apple account and Firebase project |

Each secret is recorded by name, owner and partner in THIRD-PARTY-ACCESS.md, never by value
(AGENTS.md "Security").
