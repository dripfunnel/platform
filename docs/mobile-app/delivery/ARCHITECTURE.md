# mobile-app/delivery: code architecture

How `apps/ui/mobile-app/delivery` is laid out and how it talks to the Delivery API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); the API is [api/DELIVERY.md](../../api/DELIVERY.md) §4;
builds and per-store configuration are [../README.md](../README.md) §3.

**Status: the project is set up (#848): `app.config.ts` with its tests, `stores/dev.env`, `eas.json` with a `dev` profile (an internal APK), the Expo Router skeleton with placeholder screens, the brand (the store's name and logo from the Shop API, DripFunnel's palette until more is served), and the two API clients (`src/api/client.ts`); getting in and Profile are built (#849): number and code, the first-time profile, the session in secure storage, Profile with edit, sign out and delete my account. Everything else in this document is still specification.**

Last updated: 2026-10-28 (#849: getting in and Profile, status, §2). Before: 2026-10-27 (#848: the project is set up, status, §2, §3). Before: 2026-10-22 (first version).

---

## 1. Rules

The merchant app's rules hold (merchant/ARCHITECTURE.md §1), with the Delivery API in place of the
Store API. Two of the app's own:

- **A position is sent, never stored.** The app keeps no trail of positions and never logs one.
- **Background location runs only while Online** (FIRST-RELEASE.md §1); signing out or going
  Offline stops the task before anything else.

---

## 2. Folder structure

```
apps/ui/mobile-app/delivery/
  app.config.ts             reads and validates the store's env file (../README.md §3);
                            declares background location and the Android foreground service
  stores/<storeKey>.env     one per store
  stores/<storeKey>/        that store's icon, splash and listing text
  eas.json                  one build profile per store
  src/
    app/                    Expo Router routes
      _layout.tsx           polyfills, brand, session (signed-in screens are `Stack.Protected`), push
      index.tsx             where the app starts: getting in, the first-time profile, or Home
      (auth)/sign-in        number, code
      setup  profile-edit   first-time profile, Edit profile
      (tabs)/               home  history  profile
      delivery/[id]
    features/<area>/        screens per area
    api/<area>.ts           GraphQL operations, typed from apps/api/schema/delivery.graphql
    location/               the background task: 60 s online, 15 s while a delivery is picked up
    pending/                Delivered or Not delivered kept in secure storage without signal, each with
                            its time and an idempotency key, sent in order when the connection returns
    session/  brand/  push/  nav.ts  messages/
```

Foundations come from `apps/ui/mobile-app/shared` (../README.md §2). Built in #848: `app.config.ts` declares the
background location the app needs (iOS's `location` background mode and `NSLocationAlwaysAndWhenInUse` text,
Android's `ACCESS_BACKGROUND_LOCATION` and a location foreground service, all from `expo-location`'s config plugin),
notifications and the photo library for the profile photo; the words are in `src/messages/en.json`, with the store's
name filled in. Only `STORE_HOST` reaches the running app. `src/api/client.ts` builds the Delivery API client for
`https://<STORE_HOST>/delivery-api/` and a Shop API client used only to read the store's look (`src/brand/`).
Built in #849: `session/` holds the token in secure storage (never anywhere else) and the one client, which drops the token when any call is answered `UNAUTHENTICATED`; `features/auth` is number then code (30 s before a resend, the API's 5 tries), `features/profile` is Profile and the profile form (name, photo from the camera or library uploaded to `POST /delivery-api/assets`, vehicle type and number), and `app.config.ts` also declares the camera for the photo. `location/`, `pending/`, `push/` and `nav.ts` come with their cards (DL 13–DL 14).

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-location` (built in #848), `expo-task-manager` (with the background task, DL 13) | The position in the background while Online |
| `expo-notifications` (built in #848) | Offers and assignments |
| `expo-secure-store` | The session token |
| `expo-image-picker` (built in #848) | The profile photo |
| `react-native-maps`, with the optional `GOOGLE_MAPS_ANDROID_KEY` (mobile-app/README.md §3), with the delivery screen | The warehouse's and the customer's pins |

---

## 4. Store review

Both stores check background location closely. Each store's listing needs:

- **Google Play:** the background location declaration in Play Console, with a short video of
  going Online and the foreground-service notification, and the data-safety answers (location,
  phone, photo).
- **Apple:** the `location` background mode, `NSLocationAlwaysAndWhenInUseUsageDescription` in
  the store's words, and the privacy answers.
- **Both:** the reviewer needs a rider account and can't receive the store's text. *(decide)* How
  a reviewer signs in without weakening real riders' codes (the shop app has the same need when
  a store takes mobile codes only). The shop app's answer, a demo customer with a password (shop/BUILD-CHECKLIST.md §1, decided on #869), cannot carry over: a rider has no password, so this is still open until DL 15.
