# mobile-app/delivery: building a store's delivery app and giving it to riders

What to prepare once per store, the files that make a store's build, and the steps from a build to a rider's phone. The delivery app is an **Android APK** the
store's riders install from the link in their invitation text, with no app store ([FIRST-RELEASE.md](FIRST-RELEASE.md) §1; [../README.md](../README.md) §2). Builds are manual,
one store at a time. The variables are in [../README.md](../README.md) §3, the code in [ARCHITECTURE.md](ARCHITECTURE.md), and the shop app's
[BUILD-CHECKLIST.md](../shop/BUILD-CHECKLIST.md) is the model this follows.

**Status: written on #852 (DL 15) before the first build. Nothing here has been run against a real store yet; the pilot store's first build and its install
on a phone confirm or correct it, and each step that does is noted on the card.**

Last updated: 2026-10-29 (#872: the Firebase step and the test crash). Before: 2026-10-28 (#852: first version).

---

## 1. How the pieces fit

| Piece | Where | Built on |
|---|---|---|
| The APK, kept in R2 under the store, one **version** per upload, with its version name, build number and size | api/DATA-MODEL.md §3.8 | #852 |
| **Upload or replace it** and **set the minimum build**: the store's **Delivery app** tab in the admin console (Super admin, Engineer on call) | admin FIRST-RELEASE §5.2; api/DELIVERY.md §5 | #852 |
| **The rider's link**, `https://{slug}.<SHOP_DOMAIN>/app/delivery.apk`, in the invitation text; it streams the newest APK | api/DELIVERY.md §5 | #852 |
| **Update required**: a build below the store's minimum shows that screen instead of the app, with a button to the same link. Read from the Delivery API's `minimumBuild`; no minimum, no answer or an unknown build lets the app run | `src/update/` | #852 |

**The build number** is the Android `versionCode`. `eas.json` keeps `appVersionSource: remote`, so EAS raises it on every build; the number you enter on upload is the one EAS
shows for that build (§4 step 3), and the app reads its own as `Application.nativeBuildVersion`. A mismatch means the gate compares the wrong numbers, so check it on the phone (§5).

**One EAS project per store** follows the shop app's decision ([../shop/BUILD-CHECKLIST.md](../shop/BUILD-CHECKLIST.md) §1: each store's signing credentials and push keys sit apart),
and its id is the store file's `EAS_PROJECT_ID`. *(Proposed for the delivery app, which has no reason to differ; confirm on #852.)*

---

## 2. Once per store

- [ ] The store has **own delivery** and at least one invited rider, or none yet: the link works as soon as an APK is uploaded.
- [ ] The store's **EAS project** exists and its id is in `stores/<key>.env` (`EAS_PROJECT_ID`, only if the store wants push; without it the app never asks).
- [ ] **Android signing**: EAS makes the keystore at the first Android build. **Keep the same keystore for every later build**: an APK signed with another key cannot be installed over the old one,
      and a rider would have to uninstall first.
- [ ] **Push and crash reports** (only if the store wants them; one Firebase file switches on both): its Firebase project with an Android app (the package) and **Crashlytics switched on**, `stores/<key>/google-services.json` (public client config, committed under the store's folder like the images, named by `GOOGLE_SERVICES_FILE`) and, for push, the FCM v1 key in EAS (api/DELIVERY.md §6). There is no iOS file: the app is Android only. Without the file the app reports nothing and runs as before (mobile-app/README.md §3).
- [ ] **Maps** (the customer's pin): `GOOGLE_MAPS_ANDROID_KEY` restricted to the package and the keystore's SHA-1. As for the shop app, the certificate exists only after the first build, so the
      **first build has no map**; read the SHA-1 with `eas credentials`, restrict the key, put it in the store file and build again (../shop/BUILD-CHECKLIST.md §2a).

---

## 3. Files to add for a store

Nothing in `src/` changes for a store. Add `stores/<key>.env` (every variable in ../README.md §3) and `stores/<key>/icon.png`, `icon-foreground.png`, `splash.png`
(sizes and checks as in ../shop/BUILD-CHECKLIST.md §3), plus one profile in `eas.json`:

```json
{
  "build": {
    "<key>": {
      "distribution": "internal",
      "channel": "<key>",
      "autoIncrement": true,
      "android": { "buildType": "apk" },
      "env": { "STORE_KEY": "<key>" }
    }
  }
}
```

`buildType: "apk"` makes a file a rider can install by hand; the default is an app bundle, which only Google Play installs.

---

## 4. Build it and give it to riders

1. [ ] **Gates pass** on the commit you're building: `pnpm turbo run build typecheck lint test`.
2. [ ] **Configuration resolves**: `STORE_KEY=<key> npx expo config` in `apps/ui/mobile-app/delivery` prints the store's name, package, scheme and host, and fails on a missing value or file.
3. [ ] **Build**, from `apps/ui/mobile-app/delivery`:
       ```bash
       eas build --profile <key> --platform android
       ```
       When it finishes, note the **version** (`version` in `app.config.ts`, e.g. `1.0.0`) and the **build number** EAS shows for it (`eas build:view`, "Version code"), and download the `.apk`.
4. [ ] **Upload it**: admin console › Stores › the store › **Delivery app** › Upload the app: the file, the version name, the build number from step 3 (it must be higher than the live one) and a reason.
       The first upload makes the invitation link work; a later one replaces what riders get at once. A file that is not an APK, is over 100 MB or has a build number that isn't higher is refused, and nothing is kept.
5. [ ] **Minimum build** (only when an older build must stop working, for example after an API change it can't survive): same tab › Minimum build, with a reason. It can't be above the build uploaded, and an upload never sets it.
       An app below it says **Update required** the next time it opens or comes to the front, and the rider downloads the new APK from the button.

---

## 5. Try it on a real phone

Do this on the pilot store before inviting riders, and attach a screenshot of each to the card.

- [ ] On an Android phone, open the **invitation link** (or `https://{slug}.<SHOP_DOMAIN>/app/delivery.apk`) in the browser. The file downloads; the phone asks to **allow installing from this source** the first time.
- [ ] The app installs, opens, and shows the store's name under the icon and its icon and splash.
- [ ] The invited rider's number signs in with a texted code, and the app reaches Home.
- [ ] **Update required**: set the minimum build **above** the installed one (the tab refuses above the *uploaded* build, so first upload a build one higher), open the app: it shows Update required, and **Download the new version** opens the link.
      Install the new APK **over** the old one (no uninstall: same keystore, §2), open it, and confirm Home. Then set the minimum back to none.
- [ ] With the phone offline, the app still opens (an unreachable API never blocks it).
- [ ] **Crash reports** (a store with its Firebase file): force a crash in this build (Firebase's "test crash" in the console, or a throw from a screen on a scratch branch) and see it appear in the store's Crashlytics **with no name, phone, address, position, handover code or token in it**, and the rider's opaque id as the user. Reports are off in a development build, so this is the preview build's check.

---

## 6. Over-the-air updates

A JavaScript-only change may go to one store's channel (`eas update --channel <key> --message "..."`; the rules are in ../merchant/REACT-NATIVE.md §3). `runtimeVersion` follows `version`, so a
native change needs a new build and an upload (§4), and a build too old for the API needs a minimum build (§4 step 5).
