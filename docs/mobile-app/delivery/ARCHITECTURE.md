# mobile-app/delivery: code architecture

How `apps/ui/mobile-app/delivery` is laid out and how it talks to the Delivery API. Scope is
[FIRST-RELEASE.md](FIRST-RELEASE.md); the API is [api/DELIVERY.md](../../api/DELIVERY.md) §4;
builds and per-store configuration are [../README.md](../README.md) §3.

**Status: specification, not built.**

Last updated: 2026-10-22 (first version).

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
      _layout.tsx           polyfills, brand, session, push
      (auth)/               number, code, first-time profile
      (tabs)/               home  history  profile
      delivery/[id]
    features/<area>/        screens per area
    api/<area>.ts           GraphQL operations, typed from apps/api/schema/delivery.graphql
    location/               the background task: 60 s online, 15 s while a delivery is picked up
    pending/                Delivered or Not delivered kept in secure storage without signal, each with
                            its time and an idempotency key, sent in order when the connection returns
    session/  brand/  push/  nav.ts  messages/
```

Foundations come from `apps/ui/mobile-app/shared` (../README.md §2).

---

## 3. Dependencies (each with its reason)

| Package | Why |
|---|---|
| `expo-location`, `expo-task-manager` | The position in the background while Online |
| `expo-notifications` | Offers and assignments |
| `expo-secure-store` | The session token |
| `expo-image-picker` | The profile photo |
| `react-native-maps` | The warehouse's and the customer's pins |

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
  a store takes mobile codes only).
