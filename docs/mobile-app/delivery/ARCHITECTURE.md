# mobile-app/delivery: code architecture

How `apps/ui/mobile-app/delivery` is laid out and how it talks to the Delivery API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); the API is [api/DELIVERY.md](../../api/DELIVERY.md) §4;
builds and per-store configuration are [../README.md](../README.md) §3.

**Status: the project is set up (#848): `app.config.ts` with its tests, `stores/dev.env`, `eas.json` with a `dev` profile (an internal APK), the Expo Router skeleton with placeholder screens, the brand (the store's name and logo from the Shop API, DripFunnel's palette until more is served), and the two API clients (`src/api/client.ts`); getting in and Profile are built (#849): number and code, the first-time profile, the session in secure storage, Profile with edit, sign out and delete my account; Online, background location, push and offers are built (#850): the Online switch with its permissions, one background position task, push registration and handling, and Home with offer cards; the delivery screen is built (#851): a delivery from pickup to the door, with Delivered and Not delivered kept without signal, and History. Everything else in this document is still specification.**

Last updated: 2026-10-28 (#852: the Update required gate, §2). Before: 2026-10-28 (#982: header and keyboard, §2). Before: 2026-10-28 (#851: History, status, §2). Before: 2026-10-28 (#851: steps kept without signal, status, §2, §3). Before: 2026-10-28 (#851: the delivery screen, status, §2, §3). Before: 2026-10-28 (#850: Online, location, push and offers, status, §2, §3). Before: 2026-10-28 (#849: getting in and Profile, status, §2). Before: 2026-10-27 (#848: the project is set up, status, §2, §3). Before: 2026-10-22 (first version).

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
    features/<area>/        screens per area (home, delivery, history, profile, auth)
    api/<area>.ts           GraphQL operations, typed from apps/api/schema/delivery.graphql
    location/               the background task: 60 s online, 15 s while a delivery is picked up
    pending/                Delivered or Not delivered kept in secure storage without signal, each with
                            its time and an idempotency key, sent in order when the connection returns
    session/  brand/  push/  nav.ts  messages/
    update/                 the Update required gate: a build below the store's minimum shows that screen
```

Foundations come from `apps/ui/mobile-app/shared` (../README.md §2). Built in #848: `app.config.ts` declares the
background location the app needs (iOS's `location` background mode and `NSLocationAlwaysAndWhenInUse` text,
Android's `ACCESS_BACKGROUND_LOCATION` and a location foreground service, all from `expo-location`'s config plugin),
notifications and the photo library for the profile photo; the words are in `src/messages/en.json`, with the store's
name filled in. Only `STORE_HOST` reaches the running app. `src/api/client.ts` builds the Delivery API client for
`https://<STORE_HOST>/delivery-api/` and a Shop API client used only to read the store's look (`src/brand/`).
Built in #849: `session/` holds the token in secure storage (never anywhere else) and the one client, which drops the token when any call is answered `UNAUTHENTICATED`; `features/auth` is number then code (30 s before a resend, the API's 5 tries), `features/profile` is Profile and the profile form (name, photo from the camera or library uploaded to `POST /delivery-api/assets`, vehicle type and number), and `app.config.ts` also declares the camera for the photo.

Built in #852: `update/UpdateGate` wraps every provider inside `SessionProvider`. At launch and each time the app comes to the front it asks the Delivery API's public `minimumBuild` and, when the installed build (`Application.nativeBuildVersion`, Android's versionCode) is below it, shows `UpdateRequired` instead of the app, with a button to `https://{host}/app/delivery.apk`. An unreachable API, no minimum or an unknown build lets the app run, so a rider with no signal can still deliver. BUILD-CHECKLIST.md is how a store's APK is built and uploaded.

Built in #850: `location/` is one background task (`tracking.ts`, `task.ts`) that sends the latest point every 60 s while Online and every 15 s once a parcel is picked up, then forgets it (no trail, nothing logged or stored); Offline stops the task before `setOnline(false)`, and so do sign-out and an ended session. Online is not stored: the app asks whether the task runs. Location "while using" is required (a refusal shows the settings link), iOS also asks for "always", and Android runs the task as a foreground service with its notification. `push/` registers the Expo token when the store has an `EAS_PROJECT_ID` (README §3), asks for notifications once at the first sign-in (`app/notifications.tsx`), unregisters on sign-out and turns a push into a refresh or a screen: an offer opens Home, an assignment, cancellation or recall opens the delivery, `taken` refreshes Home silently. `features/home` is Home: the Online switch, the current delivery, which stands in place of the offers (the API sends none to a rider on a delivery) and shows even when the task is not running, then `offers` paged by 20 with Show more, Accept, Decline and the Taken state. Suspended shows only at sign-in: the API answers `RIDER_SUSPENDED` there and `UNAUTHENTICATED` afterwards.

Built in #851: `features/delivery` is the delivery screen, `delivery/[id]`. Before pickup it shows the warehouse, its address with Navigate, the items and only the customer's area, with Picked up and Hand back (a sheet states the consequence). After pickup it shows the customer's name with Call, the address on a still map pin (`react-native-maps`) with Navigate, the note and the cash to collect; Delivered asks first whether the cash was collected (cash on delivery only, sent as `cashCollected`), then the 4-digit code, and Not delivered asks for a reason from the list. A wrong code says so and that too many lock the delivery, with no count: the API counts the tries per delivery and the app cannot know them after a restart. At the 5th it answers `CODE_LOCKED` and the screen says to ask the store. Navigate opens Apple Maps on iOS and a `geo:` link on Android. A delivery the store cancelled or recalled says so and, after a recall, where to bring the parcel back. Picked up and Hand back need a connection. The prototype's "Call the store" is not built: the API gives a rider no store phone number.

Built in #851 (second part): `pending/` keeps Delivered and Not delivered when the phone has no signal or the API does not answer. The step is written to secure storage (`df.pending.<host>.rider.<riderId>`, this device only, so another rider on the same phone never sees or sends it) with its time and idempotency key, the typed code with it until it is sent, and the screen says "Saved, waiting for signal" only once the write succeeded (otherwise it says the step could not be saved). The rider is the one the API names, or the last one it named when the phone has no signal. `PendingProvider` sends the steps in order, each under its own time and key, as soon as the connection returns and with a backoff (5 s doubling to 5 minutes) while it is there; it stops at the first step with no answer, and a session that ended keeps them for the next sign-in. With no signal the code gets one attempt, checked when it is sent: a late `CODE_UNCONFIRMED` leaves the delivery in `picked_up` for the store to confirm, so Home says so and no longer offers it as the rider's current delivery; any other refusal is shown once on Home and the step dropped. Nothing else is queued: Picked up, Hand back, going Online and a position are never kept.

Built in #851 (third part): `features/history` is the History tab. It shows two counts, delivered today and this week, which the API counts in the store's time zone (`deliveredToday`, `deliveredThisWeek`), then past deliveries newest first, 20 at a time with Show more: the date and time (with the time zone), the result (Delivered, Not delivered or Recalled), the warehouse and the customer's area, and the delivery fee the customer paid ("Free delivery for the customer" when there was none). It asks `deliveries` for the `delivered` and `failed` states only and never for the customer, the items or the cash, and shows nothing about the rider's pay. The tab loads again each time it is opened, so a delivery just finished is counted.

Fixed in #982: `ScreenHeader` starts below the status bar (the top safe-area inset, so every screen using it clears it), and the delivery screen lifts its footer with `KeyboardAvoidingView` (`padding` on both platforms), because an edge-to-edge Android window is not resized by the keyboard and the footer sat behind it.

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-location` (built in #848), `expo-task-manager` (#850) | The position in the background while Online |
| `expo-notifications` (built in #848) | Offers and assignments |
| `expo-secure-store` | The session token, and the steps kept without signal (#851) |
| `expo-image-picker` (built in #848) | The profile photo |
| `react-native-maps` (built in #851), with the optional `GOOGLE_MAPS_ANDROID_KEY` (mobile-app/README.md §3) | The warehouse's and the customer's pins |

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
