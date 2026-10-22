# DELIVERY.md: own delivery, dispatch and tracking

How a store delivers orders with its own delivery people: the delivery method in Shipping,
which orders it takes, how an order reaches a rider, the riders' accounts and the Delivery API
their app calls, and what the customer sees while the order is on its way. The two apps are
[mobile-app/delivery/](../mobile-app/delivery/FIRST-RELEASE.md) and
[mobile-app/shop/](../mobile-app/shop/FIRST-RELEASE.md); why they are built per store is
[mobile-app/README.md](../mobile-app/README.md).

**Status: specification, not built.** Decided with Gaurav on 2026-10-22; rows marked
*(proposed)* await a yes.

Last updated: 2026-10-22 (PR #836 fifth review: positions purged by the sweep, a new code per assignment, rider export and erase, §3, §5, §7, §8, §10). Before: 2026-10-22 (PR #836 fourth review: offer rounds, §3). Before: 2026-10-22 (PR #836 third review: offers paged, recalling a parcel in transit, the permissions in ACCESS §5). Before: 2026-10-22 (PR #836 second review: every state transition and retries, the rider's view of a customer ends with the delivery, code requests, isolation rows, fee currency, §3–§5, §10). Before: 2026-10-22 (PR #836 review: Owner-only invitations, placement re-checks own delivery, page sizes, no code in push or email, a late wrong code, §2–§8). Before: 2026-10-22 (Gaurav's answers: Enterprise by hand, dispatch when placed or ready, last steps sent late without signal, tracking on the website without the map, a handover code, §1, §3, §7, §9). Before: 2026-10-22 (first version).

**Words.** These documents call the store's delivery people **riders**, because "partner" already
means a company reselling the platform (USERS-AND-DOMAINS §1), and Settings › Shipping already
calls the couriers "delivery partners". Screens may say "Delivery partner"; the apps' prototypes
decide the wording.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Own delivery is a delivery method in Settings › Shipping**, set up like a courier (decided 2026-10-22) | A separate Deliveries area outside Shipping | Merchants already choose how orders travel in Shipping; own delivery is one more way. |
| **For each address one method applies: own delivery inside a warehouse's delivery area, the courier outside it.** The customer never chooses between the two; pickup in person may sit beside either (decided 2026-10-22) | The customer picks own delivery or the courier at checkout | The merchant decides how its orders travel, and a nearby customer is always served by the store's own people. |
| **A delivery area per warehouse**: a distance from its map pin (decided 2026-10-22) | No limit at checkout | Stops orders no rider can reasonably reach; farther addresses go by courier. Uses the pins from #814 and #815. |
| **Dispatch is a broadcast**: every online rider within the warehouse's rider distance is offered the order at once, and the first to accept gets it. If nobody accepts in time, the merchant is alerted and assigns by hand (decided 2026-10-22) | Offering to the nearest rider first, one at a time; the merchant always assigning by hand | Fills fastest and needs one job and an offer row, not a timed workflow per order. |
| **The customer sees the delivery's status, the rider's name, photo, vehicle and phone number, and a live map with an arrival estimate** while the order is on its way (decided 2026-10-22) | Status and rider details without a map; a masked number; no phone | What Gaurav asked for. The rider's real number is shown by his choice; it is the rider's own data, shown only to that order's customer while the delivery is open (§7). |
| **The merchant chooses, per store, when riders are offered an order: as soon as it is placed, or when the merchant marks it ready for pickup** (decided 2026-10-22) | Always at placement; always when ready | A shop that packs in minutes wants speed; a busier one doesn't want riders waiting at the warehouse. |
| **Proof of delivery is a code the customer gives the rider** (decided 2026-10-22) | A photo; nothing | The parcel reaches the person who ordered it, and the code proves it without storing a photo of someone's door. |
| **The storefront website's order page shows the delivery too: its steps and the rider's details, without the map** (decided 2026-10-22) | Tracking in the shop app only | A customer who bought on the website follows the same delivery; the live map stays an app feature. |
| **Riders are the merchant's own people. A rider collects cash on delivery and marks it collected; the order becomes paid.** The platform keeps no record of the cash a rider holds (decided 2026-10-22) | A cash-in-hand ledger with settlement; own delivery for prepaid orders only | The cash is between the merchant and its own employee. |
| **Riders are their own identity pool, per store**, signing in by a mobile code (decided 2026-10-22) | A Delivery role in the people pool on the Store API | A rider can never reach the Store API or a merchant screen. The people pool needs an email and is per partner; a rider has a phone and works for one store. |
| **The Delivery API** at `/delivery-api/` on the store's `{slug}.<SHOP_DOMAIN>` host, next to `/shop-api/` (decided 2026-10-22) | Rider operations inside the Store or Shop API | Its own schema, caller kind and hostname guard, so neither shoppers nor merchants can call a rider operation, nor riders theirs. |
| **Push notifications through Expo's push service** *(proposed)* | Calling APNs and FCM directly | The apps are Expo apps. One HTTPS call covers both platforms, and each store's APNs and FCM credentials stay in EAS with the rest of its build credentials. |
| **A rider's position is one row, overwritten**: never a history (§7) *(proposed)* | A trail of positions per delivery | Personal data kept to the minimum (AGENTS.md "Data"). Dispatch and the live map need only the latest point. |

---

## 2. The delivery method

**Settings › Shipping** gains **Own delivery**, beside the courier, flat-rate and pickup choices
(store/FIRST-RELEASE.md §15). Turning it on needs at least one active rider (§5) and a pinned
warehouse with its area set. Nothing checks that the delivery app is in an app store: riders may
install it as an APK (mobile-app/README.md §2, decided 2026-10-22). It is Owner-only, like the rest of Shipping.

Per warehouse that delivers (Settings › Warehouse, a location's form; the merchant's own locations only, never a supplier's):

| Setting | Meaning |
|---|---|
| Delivers with own riders | On or off; needs the warehouse's map pin (#815) |
| Delivery area | Kilometres from the pin, straight line, 1–50 |
| Rider distance | Kilometres from the pin within which online riders are offered an order, 1–50 *(proposed: default 5)* |
| Fee | What the customer pays, in the store's currency; Shipping's "free over" rule applies to it as to every method *(proposed)* |

Store-wide: **offer to riders** when the order is placed, or when the merchant marks it ready
(default: when ready, *proposed*), and **minutes before the merchant is alerted** when nobody
accepts (1–30, default 5).

**At checkout** (Shop API `shippingOptions`) *(proposed in detail)*:

1. The address has a pin (#814). An address with no pin is outside every area. The shop app
   always asks for a pin; the storefront's is optional, so a storefront shopper who skips it
   gets the courier.
2. Own delivery is offered when the pin is inside the area of a delivering warehouse that holds
   every line of the cart, the nearest such warehouse taking it. The courier and flat-rate
   options are then not offered.
3. Otherwise the existing options apply, unchanged.
4. Pickup, when on, is offered in both cases.
5. **At placement the engine runs the same rule again** on the address pin and the stock it holds,
   and takes the option, warehouse and fee from that, never from the client. An own-delivery option
   the rule no longer gives is refused `SHIPPING_UNAVAILABLE`, as any option no longer offered is
   (`engine/modules/cart/rules.ts`).

Own delivery takes the store's own part of an order, and a to-store supplier's lines once handed
over. An order with a to-shopper supplier's lines is not offered own delivery (decided 2026-10-22):
those lines travel with the supplier's courier, and one order would arrive in two ways.

---

## 3. Dispatch

An order placed with own delivery gets a **delivery** (DATA-MODEL §7.12) once it can ship: at
placement for cash on delivery, at payment otherwise (a bank transfer waits for its payment, as
`shipItems` does). With the store's "when ready" setting it waits in `packing` until someone with
`orders.fulfil` marks it **ready for pickup** (`markReadyForPickup`); with "when placed" it starts
at `searching`. A change of the setting applies to orders placed after it.

1. **Offer.** A queue job finds the store's riders who are **online** and whose latest position is
   within the warehouse's rider distance, and writes one offer per rider. Each gets a push
   ("New delivery, 2.4 km away"). With nobody in range, step 3 starts at once.
2. **Accept.** The first rider to accept takes it, in one conditional update on the delivery
   (`state = 'searching'`), so two accepts can never both win. The other offers close and those
   riders' apps show it as taken. A decline closes only that rider's offer.
3. **Nobody accepts.** After the store's minutes, the delivery is marked `unassigned`. The merchant
   is alerted by email and on the order (portal and merchant app), and can **assign by hand**
   any active rider, who gets a push and the delivery straight away. Riders coming online later
   are not offered it *(proposed)*.
4. **Hand-over and travel.** At the warehouse the merchant hands over the parcel and the rider
   marks it **picked up**. That ships the order: a fulfilment of kind `local` takes the delivery's
   lines out of its warehouse as `shipItems` does (store/FIRST-RELEASE.md §19 Part 2).
5. **At the door.** The customer reads out the **handover code** and the rider enters it to mark
   the delivery **delivered**, saying first, for cash on delivery, that the cash was collected; or **not delivered** with a reason (no one home, refused, wrong address),
   and returns the parcel. A failed delivery is the merchant's to retry (offer again) or cancel.

**States** *(proposed in detail)*. Every transition, and who makes it:

| From | To | By |
|---|---|---|
| `packing` | `searching` | Ready for pickup (merchant) |
| `searching` | `assigned` | a rider accepts |
| `searching` | `unassigned` | nobody accepts in the store's minutes, or nobody in range |
| `unassigned` | `searching` | Offer again (merchant): the same delivery, a new offer round |
| `unassigned` | `assigned` | assigned by hand (merchant) |
| `assigned` | `searching` | hand back (rider): a new offer round without that rider |
| `assigned` | `picked_up` | picked up (rider) |
| `picked_up` | `delivered` | the right code (rider); or the merchant with a reason when the code is locked or unconfirmed |
| `picked_up` | `failed` | not delivered (rider); the merchant for an unconfirmed code; or the merchant **recalls** it (`cancelDelivery` on a picked-up delivery, reason `recalled`): the rider is told by push to bring the parcel back, and their access to the customer's details and the code end at once |
| `packing`, `searching`, `unassigned`, `assigned` | `cancelled` | the merchant cancels the delivery, or the order is cancelled |

An order whose delivery is `picked_up` can't be cancelled: `cancelOrder` already refuses any order
something has left (`NOT_CANCELLABLE`, store/FIRST-RELEASE.md §19 Part 4), and a parcel in transit
has left. The merchant recalls the delivery first, then refunds through the return path.

**Offer rounds.** Every move into `searching` starts a new round of offers (the delivery's
`offer_round` goes up by one): the first broadcast, each Offer again and each hand back. A rider
has at most one offer per round, so the riders offered before are offered again; the previous
round's open offers close as `expired`, and an accept answers only for the current round.

`delivered`, `failed` and `cancelled` are final. A delivery with `code_unconfirmed_at` stays
`picked_up` and only the merchant moves it on. Nobody reassigns a parcel in transit.

**Trying again after `failed`** (the parcel is back at the warehouse): Offer again makes a **new
delivery** for the same order, in `searching`, with new offers (its handover code is made when a
rider is assigned, as for every delivery); the
failed one keeps its rider and reason as history, and that rider's access to the customer's
details has already ended (§4). The new delivery's pickup writes no second fulfilment: the
order's `local` fulfilment already took the stock out. Cancelling the order after a failed
delivery follows the existing return path (store/FIRST-RELEASE.md §19).

**Handover code** *(details proposed)*. Four digits, made when a rider is assigned, shown only to the
order's customer, and only where they are signed in or hold the order's link: the shop app's
order screen and the website's order page. **No push or email carries it**: the "on the way"
push and email say to open the order to see the code, so a lock screen or a forwarded email never
shows it. The rider never reads it. A wrong code is refused (`WRONG_CODE`); after 5 wrong codes
the delivery is locked (`CODE_LOCKED`) and only the merchant can mark it delivered, from the
order, with a reason. The code is kept encrypted and deleted when the delivery ends.

A new code is made at every assignment: when a rider hands a delivery back, its code is deleted and
the next rider's assignment makes a fresh one, so a code told to the first rider is useless.

**Delivered without signal** *(proposed)*. The app keeps the step and the code the rider typed in
secure storage, deleted once sent, and allows one attempt while offline; the server checks it when
it arrives, as one try. If the code is wrong, the delivery stays `picked_up`, marked
`code_unconfirmed_at`, and the API answers `CODE_UNCONFIRMED`: the rider's app says the code
didn't match and the store will confirm, and the merchant is alerted by email and on the order.
The merchant then marks it delivered with a reason, as for `CODE_LOCKED`, or not delivered. The
cash collected sent with it is kept on the delivery, and the order becomes paid only when the
delivery becomes `delivered`. With signal the rider retries at the door as usual.

**The minute sweep** *(proposed)*: one Cron trigger every minute in `src/jobs`, per store, that
(a) moves `searching` deliveries older than the store's minutes to `unassigned` and queues the
merchant's email (step 3), and (b) deletes `rider_position` rows older than 10 minutes and clears
those riders' `online_at`. It is idempotent: a second run in the same minute changes nothing.

**Online.** A rider switches **Online** in the app. While online the app sends its position every
60 seconds; a rider with no position for 10 minutes counts as offline *(proposed)*, and the
minute sweep (below) then deletes their position and clears their online state, so a phone
that dies or loses signal for good leaves no point behind.

---

## 4. The Delivery API

GraphQL at `https://{slug}.<SHOP_DOMAIN>/delivery-api/`, schema `apps/api/schema/delivery.graphql`,
code in `src/apis/delivery`. Store-proxy's `StorefrontEdge` passes `/delivery-api/*` through as it
does `/shop-api/*`. It answers only on the store's `{slug}.<SHOP_DOMAIN>` host: never on a
preview host, a merchant's own domain or any of our hosts, and every other API answers 404 on
it (ARCHITECTURE §2). The caller is the rider's bearer token; there is no cookie, so no `Origin`
check.

| Operation | Does |
|---|---|
| `requestCode(phone)`, `signIn(phone, code)`, `signOut` | Sign-in by a 6-digit text code (§5). `requestCode` answers the same, at once, for every number; the text is queued through the outbox only for an invited or active rider of this store, so neither the answer nor its timing tells who is invited, and nobody can send texts to uninvited numbers at the partner's cost. Limits: 3 a number in 10 minutes, the per-address limiter, and 50 a store in 10 minutes, as shoppers' codes (ACCESS §2.1) |
| `me`, `updateProfile(name, photo, vehicleType, vehicleNumber)` | The rider's own profile |
| `setOnline(online)`, `reportPosition(lat, lng, accuracy, at)` | Being available; the latest position (§7) |
| `offers(first, after)` | This rider's open offers, newest first, keyset-paged: `first` 20 by default, at most 50; each with the warehouse, distance, number of items and the customer's area (never the address before accepting) |
| `acceptOffer(id)`, `declineOffer(id)` | §3 steps 1–2; a lost race answers `TAKEN` |
| `deliveries(state, first, after)` | This rider's deliveries, newest first, keyset-paged: `first` 20 by default, at most 50. A past delivery shows its date, state, warehouse, the customer's area name and the fee, never the customer's name, phone, address or pin |
| `delivery(id)` | One delivery: warehouse address and pin, the lines and quantities; **while the rider holds it open** (`assigned` or `picked_up`) also the customer's name, phone, address, pin and note, and the cash to collect. Once it is delivered, failed, cancelled or handed back, none of the customer's details are returned again |
| `handBack(id)`, `markPickedUp(id)`, `markDelivered(id, code, cashCollected, at, key)`, `markFailed(id, reason, at, key)` | §3 steps 4–5. `markDelivered` refuses a wrong code (`WRONG_CODE`, then `CODE_LOCKED`), and for cash on delivery a missing `cashCollected` (`CASH_NOT_CONFIRMED`); a wrong code arriving late answers `CODE_UNCONFIRMED` (§3, Delivered without signal). The last two may arrive late from a phone that had no signal (decided 2026-10-22, delivery/FIRST-RELEASE.md §1): `at` is when the rider did it, accepted between pickup and now and kept as the step's time; `key` makes a resend do nothing twice |
| `registerPushDevice(token, platform)` | The Expo push token for this phone (§6) |

Every list in this API and in §8 is keyset-paged with a stated maximum, never above the scoped
layer's `maxPageSize` (100). A rider reads and writes only their own offers and deliveries, of their own store. Every write
goes to the activity log with actor kind `rider` (LOGGING.md §4), the delivery as target.
Sign-in is rate-limited per number and per address, as the Shop API's codes are.

---

## 5. Riders

- **Invited by the Owner** (Store API `inviteRider(name, phone)`) from **Settings › Riders**, a new
  tab, Owner only like the rest of Settings (store/FIRST-RELEASE.md §15), on the web and in the
  merchant app. The rider gets a text, sent through the
  partner's SMS account (MSG91 or Twilio) like every code, with the store's name and the store's
  delivery app links.
- **Signing in is joining.** The invited number signs in with a code and the invitation is taken;
  there is no link or token. A number never invited gets the same answer as a wrong code, so the
  API never reveals which numbers a store has invited (AGENTS.md "Security"). A code is kept only
  for an invited or active rider's number, and code rows are deleted a day after they expire.
- **Profile:** name, photo, vehicle type (bike, scooter, car, bicycle, on foot), vehicle number.
- **The merchant** sees each rider's status (invited, active, suspended), online now, current
  delivery and deliveries done, and can **suspend** (sessions end at once) or **remove** (the row
  stays, so past deliveries keep their rider; the phone is erased, AGENTS.md "Data").
- **Export and erase** *(proposed, built on #874)*: the Owner can export one rider's data (profile,
  deliveries with dates, states, warehouse and the customer's area name only, sign-in times) as an
  export job, and **erase** a rider: removal, then "Former rider" in place of their name in past
  deliveries and the activity log's labels (LOGGING §8), with their sessions, devices and position
  deleted. A rider's own Delete my account does the same.
- **Sessions** last 30 days from last use, like customers' (DATA-MODEL §3.4), one per phone.
- **A rider belongs to one store.** The same person delivering for two stores has two accounts
  and two apps, as a customer does.
- **Plan:** the number of riders is a plan limit (§9).

---

## 6. Notifications

Every push is a side effect of a write, so it goes through the outbox (AGENTS.md "Reliability"),
then one HTTPS call to Expo's push service with a timeout and retries. Tokens Expo reports as
dead are deleted. A push never carries an address, a phone number or an amount; the app reads
those through its API.

| Who | When |
|---|---|
| Rider | An offer; a delivery assigned by hand; an offer taken by someone else (silent update); a delivery cancelled |
| Customer (shop app) | Rider assigned; picked up and on the way; delivered; not delivered |
| Merchant | Nobody accepted (§3 step 3), or a code unconfirmed after a late Delivered (§3), by email; the merchant app has no push yet |

The order emails the customer already gets for a shipment stay as they are. Neither a push nor an
email ever carries the handover code (§3).

---

## 7. Tracking

**What the customer sees** (Shop API `order(id).delivery`, the order's own customer or a guest
with its token):

- the state and the time of each step (`packing` reads "Being packed");
- once assigned: the rider's first name, photo, vehicle type and number, and phone number;
- while `picked_up`: the rider's latest position and its time, and an arrival estimate;
- while it is `assigned` or `picked_up`: the handover code (§3).

**On the website** (storefront-core's order page, with a changeset) the same steps, rider details
and handover code are shown, never the map, the position or the estimate (decided 2026-10-22).

The rider's details and position disappear from the answer once the delivery ends (delivered,
failed or cancelled); the state history stays.

**Position.** While a delivery is `picked_up` the delivery app sends its position every 15
seconds, otherwise every 60 seconds while online. `rider_position` keeps one row per rider
(the latest point), overwritten, and deleted when the rider goes offline, when the sweep finds it
older than 10 minutes, and when the rider signs out, is suspended, removed or erased. No trail is kept, and
positions never enter the activity log or technical logs.

**Arrival estimate** *(proposed)*: from Google's Routes API, server-side, at pickup and at most every
2 minutes after while someone is watching, with a server key restricted to that API (THIRD-PARTY-
ACCESS §2.12). Without the key, the estimate is left out.

**The customer's app** asks again every 15 seconds while the tracking screen is open; there is no
socket *(proposed)*.

**Who sees a rider's phone:** the customer of an open delivery the rider carries, the merchant's
people with `orders.read`, and the rider. Never another customer, a supplier, or after the
delivery ends.

---

## 8. Merchant side (Store API)

| Addition | Permission |
|---|---|
| Own delivery in `shippingSettings`, the warehouse's delivery settings in `saveWarehouse` (§2) | As those operations today (Owner) |
| `riders(first, after)` (50 by default, at most 100), `inviteRider`, `resendRiderInvitation`, `suspendRider`, `restoreRider`, `removeRider`, `exportRider` (a job), `eraseRider` (§5) | New `riders.manage`: Owner |
| `order(id).delivery`: state, history, rider, position while picked up | `orders.read` |
| `markReadyForPickup(orderId)` (§3) | `orders.fulfil` |
| `assignDelivery(deliveryId, riderId)`, `offerDeliveryAgain(deliveryId)`, `cancelDelivery(deliveryId)` (before pickup it cancels; after, it recalls, §3), `markDeliveryDelivered(deliveryId, reason)` (a locked or unconfirmed code, §3) | `orders.fulfil` |

A supplier never sees riders, positions or a delivery: own delivery carries only the store's
lines (§2), so a supplier's `orders.fulfil` (ACCESS §5.2) never reaches these actions; they
check the merchant side as well as the permission (ACCESS §5.1). A support session reads them as `orders.read` allows, never a rider's phone.

---

## 9. Plans

Two new plan settings (SAAS.md §6.1), **Planned** until built:

- `own_delivery`, on/off, with **riders** as a limit;
- `own_apps`, on/off: the store's shop and delivery apps (mobile-app/README.md).

**Enterprise only, set up by hand** (decided 2026-10-22): both are off in every listed plan, and
DripFunnel staff turn them on for one store, with its riders limit, as that store's override in the
admin console (`store_limit_override`, SAAS.md §6.1), once the merchant's Enterprise arrangement is
agreed. There is no Enterprise plan on the pricing page and nothing to buy in the portal.

---

## 10. Testing

- The isolation matrix (ACCESS.md §11.1) gains these rows, each refused:
  - **Delivery API:** another store's rider; a removed or suspended rider; a rider reading or
    acting on another rider's offer or delivery; a rider reading the customer's details after
    the delivery ends or after handing it back; a shopper token or a portal session on the
    Delivery API; a rider token on the Shop and Store APIs.
  - **Shop API:** another customer, or a guest with another order's token, reading an order's
    delivery, handover code, rider phone or position; anyone reading the rider's details or
    position after the delivery ends.
  - **Store API:** a supplier (any tier) reading a delivery, a rider or a position; a support
    session reading a rider's phone; Manager, Staff, an API key or an app grant calling
    `riders.manage` operations; a seat without `orders.fulfil` calling the delivery actions;
    another store's merchant reading any of it.
  - **Rows:** `push_device`, `rider_position`, `delivery` and `delivery_offer` never cross
    stores.
  - **Export and erase:** `exportRider` and `eraseRider` refused for every seat but the Owner and
    for another store's rider; the export holds no customer address or phone.
- A rider's position is gone after the minute sweep (§3) finds it 10 minutes old, sign-out, suspension, removal and erasure.
- The customer reads the rider's details only while `assigned` or `picked_up`, and the position only
  while `picked_up`.
- Two accepts of one offer at once: exactly one wins.
- The hostname guard: `/delivery-api/` answers only on `{slug}.<SHOP_DOMAIN>`.

---

## 11. Open questions

- ~~Which plans include `own_delivery` and `own_apps`~~ Enterprise, turned on by hand per store (decided 2026-10-22, §9).
- ~~Must the delivery app be in an app store first?~~ No: riders may install the APK directly, and
  nothing checks (decided 2026-10-22, §2).
- ~~Does the storefront website show the delivery too?~~ Yes, without the map (decided 2026-10-22, §7).
- ~~Proof of delivery?~~ A code the customer gives the rider (decided 2026-10-22, §3).
- ~~Should dispatch wait until the order is ready?~~ The merchant chooses per store (decided 2026-10-22, §2, §3).
- ~~An order with a to-shopper supplier's lines?~~ The whole order goes by courier (decided 2026-10-22, §2).
- *(decide)* Distance in SQL (haversine on the pins) or PostGIS on Neon; haversine is enough for
  one store's riders.
