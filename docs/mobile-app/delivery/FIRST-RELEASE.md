# mobile-app/delivery: the first release

The store's app for its own delivery people (riders): what its first release contains. How
orders reach riders, the Delivery API and tracking are [api/DELIVERY.md](../../api/DELIVERY.md);
who gives the app and how it is built per store is [../README.md](../README.md); the code is
[ARCHITECTURE.md](ARCHITECTURE.md).

**Status: specification, not built.** No prototype yet (§3).

Last updated: 2026-10-22 (the handover code; Delivered and Not delivered kept without signal). Before: 2026-10-22 (first version, with Gaurav).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **A separate app, one per store, in the store's brand** (decided 2026-10-22) | A rider mode in the merchant app; one delivery app per partner | The merchant gives it to its own people (../README.md §2). |
| **Android first, installable as an APK** from a link in the invitation text, with no app store needed (decided 2026-10-22; ../README.md §2). The APK is kept in R2 under the store; an over-the-air update (EAS Update) reaches it like any build, and a build too old for the API is told to download the new APK *(proposed)* | Google Play or the App Store first | Own delivery can start the day the merchant invites its riders. |
| **Riders sign in with their mobile number and a texted code**; the merchant's invitation is matched by the number (api/DELIVERY.md §5) | Email and password; an invitation link | Riders have a phone, not necessarily an email, and a link needs the app installed first. |
| **No earnings or pay in the app**: delivery counts only (decided 2026-10-22) | Per-delivery pay set by the merchant, with earnings and payout summaries | Riders are the merchant's own people, paid outside the platform. |
| **Location in the background only while Online** *(proposed)* | Location whenever the app runs | Dispatch and tracking need it only then (api/DELIVERY.md §3, §7), and both stores ask apps to justify background location. Going Offline stops it and deletes the position. |
| **Delivered and Not delivered are kept on the phone without signal and sent when it returns**, with the time they happened; the screen says "Saved, waiting for signal" (decided 2026-10-22). Every other step needs a connection. Offline, the handover code gets one attempt, checked when the step is sent; a wrong one leaves the delivery for the store to confirm (api/DELIVERY.md §3) | Every step needs a connection | Doorsteps are often out of signal, and a rider shouldn't have to walk to find it. Only the last step of a delivery is queued, so nothing else can be out of order. |

---

## 2. What the release contains

| Area | Contains |
|---|---|
| **Getting in** | Mobile number, code; first time: name, photo, vehicle type and number. Delete my account in Profile (Apple 5.1.1(v)) |
| **Home** | **Online / Offline**. While online: open offers as cards (warehouse, distance, items, the customer's area, time left), Accept and Decline; the current delivery on top |
| **A delivery** | Before pickup: the warehouse's address, Navigate (opens Google or Apple Maps), the items and quantities, **Picked up**, Hand back. After: the customer's name, **Call**, address and pin, Navigate, the customer's note, the cash to collect; **Delivered** after entering the customer's **handover code** (with "Cash collected" for cash on delivery) or **Not delivered** with a reason |
| **History** | Deliveries done today and this week, then past deliveries, newest first, 20 at a time with Show more, each with the delivery fee the customer paid. Nothing about the rider's pay (§1) |
| **Notifications** | New offer, delivery assigned by hand, offer taken, delivery cancelled (api/DELIVERY.md §6) |
| **Profile** | Edit, sign out, delete account |

**Permissions the app asks for, and when:** notifications at first sign-in; location "while using"
when first going Online, then "always" (iOS) or a foreground service with its notification
(Android), with the store's reason in words.

---

## 3. Design

There is no prototype yet. **Before any screen is built**, `designs/DF Delivery App Prototype.dc.html`
is drawn, with every screen above and its empty, loading, error, offline and permission-refused
states, and `designs/design.md` maps it.

---

## 4. Open questions

None for the product: proof of delivery, sending without signal and earnings were settled on
2026-10-22 (§1, §2). One engineering choice is open: how store reviewers sign in
(ARCHITECTURE.md §4, *(decide)*).
