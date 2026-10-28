# mobile-app/delivery: code architecture

How `apps/ui/mobile-app/delivery` is laid out and how it talks to the Delivery API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); the API is [api/DELIVERY.md](../../api/DELIVERY.md) §4;
builds and per-store configuration are [../README.md](../README.md) §3.

**Status: the project is set up (#848): `app.config.ts` with its tests, `stores/dev.env`, `eas.json` with a `dev` profile (an internal APK), the Expo Router skeleton with placeholder screens, the brand (the store's name and logo from the Shop API, DripFunnel's palette until more is served), and the two API clients (`src/api/client.ts`); getting in and Profile are built (#849): number and code, the first-time profile, the session in secure storage, Profile with edit, sign out and delete my account; Online, background location, push and offers are built (#850): the Online switch with its permissions, one background position task, push registration and handling, and Home with offer cards. Everything else in this document is still specification.**

Last updated: 2026-10-28 (#850: Online, location, push and offers, status, §2, §3). Before: 2026-10-28 (#849: getting in and Profile, status, §2). Before: 2026-10-27 (#848: the project is set up, status, §2, §3). Before: 2026-10-22 (first version).

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
Built in #849: `session/` holds the token in secure storage (never anywhere else) and the one client, which drops the token when any call is answered `UNAUTHENTICATED`; `features/auth` is number then code (30 s before a resend, the API's 5 tries), `features/profile` is Profile and the profile form (name, photo from the camera or library uploaded to `POST /delivery-api/assets`, vehicle type and number), and `app.config.ts` also declares the camera for the photo.

Built in #850: `location/` is one background task (`tracking.ts`, `task.ts`) that sends the latest point every 60 s while Online and every 15 s once a parcel is picked up, then forgets it (no trail, nothing logged or stored); Offline stops the task before `setOnline(false)`, and so do sign-out and an ended session. Online is not stored: the app asks whether the task runs. Location "while using" is required (a refusal shows the settings link), iOS also asks for "always", and Android runs the task as a foreground service with its notification. `push/` registers the Expo token when the store has an `EAS_PROJECT_ID` (README §3), asks for notifications once at the first sign-in (`app/notifications.tsx`), unregisters on sign-out and turns a push into a refresh or a screen: an offer opens Home, an assignment, cancellation or recall opens the delivery, `taken` refreshes Home silently. `features/home` is Home: the Online switch, the current delivery, which stands in place of the offers (the API sends none to a rider on a delivery) and shows even when the task is not running, then `offers` paged by 20 with Show more, Accept, Decline and the Taken state. Suspended shows only at sign-in: the API answers `RIDER_SUSPENDED` there and `UNAUTHENTICATED` afterwards. 

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-location` (built in #848), `expo-task-manager` (#850) | The position in the background while Online |
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
