# mobile-app/merchant: before building a partner's app

The files to change for a partner's branding, and the checks to run before every build and
submission. Builds are manual (BUILDS-AND-STORE-ACCOUNTS.md §2), so this list is what keeps them
right. The variables are explained in [CONFIGURATION.md](CONFIGURATION.md).

**Status: proposed, not built.** The commands assume the app's setup in ARCHITECTURE.md §3.

Last updated: 2026-10-30 (#878: the local files `eas build` needs for the crash test, §4). Before: 2026-10-29 (#878: the `preview` profile for the crash test, §4). Before: 2026-10-28 (#878: crash reports, §1, §3, §4). Before: 2026-10-08.

---

## 1. Once per partner

Before the partner's first build:

- [ ] The partner has enrolled with Apple and Google as an organization and given DripFunnel
      access with the least role needed (BUILDS-AND-STORE-ACCOUNTS.md §2, §5).
- [ ] The partner's portal host is live, and the Store API's brand query answers on it.
- [ ] The partner has uploaded its **app icon** and **splash image** on the partner console's
      branding screen (BUILDS-AND-STORE-ACCOUNTS.md §5).
- [ ] The bundle id is registered in the partner's Apple account, and the app is created in
      App Store Connect and in Play Console.
- [ ] The partner's secrets are in EAS's credential store (CONFIGURATION.md §3), never in the
      repo.
- [ ] **Crash reports** (optional): the partner's own Firebase project has an Android and an iOS app under the
      bundle id and package, Crashlytics is on, and its two client files are EAS file variables
      (`GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`) for the partner. Then `CRASH_REPORTING=on` goes in
      the partner's file (CONFIGURATION.md §2, §3).
- [ ] **Google sign-in** (optional, #1048): in the Google Cloud project whose web client is on the partner
      console's Settings › Integrations, an **iOS** OAuth client for the bundle id and an **Android** one for the
      package with the SHA-1 of the build's signing key (EAS's, `eas credentials`). The web and iOS client IDs go
      in the partner's file as `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` (CONFIGURATION.md §2); the
      Android client needs no value in the app. A development or store build is needed to try it, never Expo Go.

---

## 2. Files to add or change for a partner's branding

Only these files change. **Nothing in `src/` changes for a partner**: if a partner seems to need
a code change, stop and ask, because per-partner behaviour in code breaks ARCHITECTURE.md §1
rule 3.

| File | What to put in it | Check |
|---|---|---|
| `partners/<partner>.env` | Every variable in CONFIGURATION.md §2 | Validates (§3 step 3) |
| `partners/<partner>/icon.png` | The app icon, from the branding upload | 1024 × 1024 PNG, **no transparency** and no rounded corners (the stores round them) |
| `partners/<partner>/icon-foreground.png` | Android adaptive icon foreground | 1024 × 1024 PNG, transparent background, the mark inside the centre 66% (Android crops the rest) |
| `partners/<partner>/splash.png` | Splash image: the partner's mark | PNG, transparent background, mark centred; looks right on `SPLASH_BACKGROUND` |
| `partners/<partner>/listing/` | Store listing text, screenshots, privacy and data-safety answers | Matches the partner's name and look; no DripFunnel name unless the "Powered by" rule shows it (SAAS.md §3.4) |
| `eas.json` | A build profile and a submit profile named `<partner>` | Reads `partners/<partner>.env`; update channel = `UPDATES_CHANNEL`; submit points at the partner's own store accounts |

**Not changed here:** the logo inside the app, colours, font, corner style, wording and support
contact. The app loads those at runtime from the brand query (`partner_branding`), and the
partner changes them on the partner console's branding screen with no new build.

When the partner changes its **app icon or splash** on the branding screen, update the files
above and make a new build: the stores read those before the app runs.

---

## 3. Before every build

1. [ ] **Gates pass** on the commit you're building: `pnpm turbo run build typecheck lint test`.
2. [ ] **Branding images are current**: download the latest icon and splash from
       `partner_branding` into `partners/<partner>/`, and check them against §2.
3. [ ] **Configuration resolves**: run `expo config` with the partner's profile. It must print
       the partner's name, bundle id, package and domain, and fail on any missing value.
4. [ ] **The portal answers**: the brand query on `PARTNER_DOMAIN` returns the partner's look.
5. [ ] **Version**: a new store release bumps the app version (shared by every partner); EAS
       increments the build number.
6. [ ] **Store rules**: the Expo SDK still meets Apple's Xcode and Google's target API level
       requirements (REACT-NATIVE.md §3). Before a partner's first submission, re-check the
       guideline text in BUILDS-AND-STORE-ACCOUNTS.md §3.
7. [ ] **After an Expo SDK change**: the `Intl` check on Hermes has passed (REACT-NATIVE.md §6).
8. [ ] **Crash reports**: for a partner with `CRASH_REPORTING=on`, `expo config` shows both `googleServicesFile` paths and
       `extra.crashReporting`, and fails if a Firebase file is missing. A partner without it shows neither.

---

## 4. Try a preview build on a real phone

Build a preview with the partner's profile and install it on one iPhone and one Android phone:

- [ ] The name under the icon, the icon and the splash are the partner's.
- [ ] The partner's colours, logo and font load before the first screen.
- [ ] Sign-in, 2-factor and the store chooser work.
- [ ] No DripFunnel name or logo appears, except where the "Powered by" rule shows it.
- [ ] Help opens the partner's help centre; "Best on the web" opens the partner's portal in the
      browser (DESIGN.md §5).
- [ ] Money, dates and counts are formatted in the store's settings.
- [ ] **Crash reports** (a partner with `CRASH_REPORTING=on`): the build links with the other native modules (the Firebase
      Apple SDK makes its pods dynamic frameworks, `ios.useFrameworks`, which is **not yet proven on a device**). A forced
      crash on each phone appears in the partner's Crashlytics with only the person's opaque user id and the acting
      store id, no name, email or message text. A `dev` build reports nothing. For the `dev` partner's test, build with
      `eas build --profile preview --platform all`: it is a release build (a development-client build never reports) and
      its profile sets `CRASH_REPORTING=on`, so the two Firebase files must be EAS file variables first, in the **`preview`**
      environment. `eas build` also reads the config on your own PC, where those variables are not set: in that shell, set
      `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST` to local copies of the two files (outside the repo) for the command; the
      cloud build uses the EAS ones.

---

## 5. Build and submit

By hand, one partner at a time (BUILDS-AND-STORE-ACCOUNTS.md §2):

```bash
eas build --profile <partner> --platform all
eas submit --profile <partner> --platform all --latest
```

Then enter or update the listing in App Store Connect and Play Console from
`partners/<partner>/listing/`.

**An over-the-air update** (JavaScript only, no change to the app's purpose,
REACT-NATIVE.md §3) is published by hand to one partner's channel:

```bash
eas update --channel <partner> --message "<what changed>"
```
