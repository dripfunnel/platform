# DELIVERY.md: own delivery, dispatch and tracking

How a store delivers orders with its own delivery people: the delivery method in Shipping,
which orders it takes, how an order reaches a rider, the riders' accounts and the Delivery API
their app calls, and what the customer sees while the order is on its way. The two apps are
[mobile-app/delivery/](../mobile-app/delivery/FIRST-RELEASE.md) and
[mobile-app/shop/](../mobile-app/shop/FIRST-RELEASE.md); why they are built per store is
[mobile-app/README.md](../mobile-app/README.md).

**Status: specification, partly built.** Decided with Gaurav on 2026-10-22; rows marked
*(proposed)* await a yes. Built: the riders pool and its invitations (§5, §8, §9; #838); the Delivery API with
riders' sign-in, profile and account deletion (§4, §5; #839); own delivery as a Shipping method, the warehouses'
delivery areas and the checkout option (§2, §8; #841); dispatch: delivery creation, Ready for pickup, offer rounds,
accept and decline, assignment by hand, cancellation before pickup, online state, positions and the minute sweep
(§3, §4, §8; #842); carrying it: pickup as a `local` shipment, the handover code, Delivered and Not delivered sent
late, recall and the merchant's confirmation (§3, §4, §6, §8; #843).

Last updated: 2026-10-26 (#843: pickup, the handover code, cash on delivery, steps sent late, recall, the customer's
events, §3, §4, §6, §8). Before: 2026-10-26 (#842: dispatch, offer rounds and positions; a rider's phone on an order only to a person, §3, §8). Before: 2026-10-26 (#841: own delivery in Shipping and Warehouse, the checkout rule and placement built, haversine decided, §2, §8, §11). Before: 2026-10-26 (#840: push through Expo, `registerPushDevice` and `unregisterPushDevice`, §4, §6). Before: 2026-10-23 (#839: the Delivery API's sign-in, profile and account deletion, §4, §5). Before: 2026-10-23 (#838: riders, invitations, suspension and removal in the Store API, the plan keys, §5, §8, §9). Before: 2026-10-22 (PR #836 later reviews: customer details only after pickup, suspension and removal hand back, a new delivery after a cancel, §3–§5, §10). Before: 2026-10-22 (PR #836 fifth review: positions purged by the sweep, a new code per assignment, rider export and erase, §3, §5, §7, §8, §10). Before: 2026-10-22 (PR #836 fourth review: offer rounds, §3). Before: 2026-10-22 (PR #836 third review: offers paged, recalling a parcel in transit, the permissions in ACCESS §5). Before: 2026-10-22 (PR #836 second review: every state transition and retries, the rider's view of a customer ends with the delivery, code requests, isolation rows, fee currency, §3–§5, §10). Before: 2026-10-22 (PR #836 review: Owner-only invitations, placement re-checks own delivery, page sizes, no code in push or email, a late wrong code, §2–§8). Before: 2026-10-22 (Gaurav's answers: Enterprise by hand, dispatch when placed or ready, last steps sent late without signal, tracking on the website without the map, a handover code, §1, §3, §7, §9). Before: 2026-10-22 (first version).

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
(store/FIRST-RELEASE.md §15). Turning it on needs the plan's `own_delivery` (§9), at least one active
rider (§5) and a pinned warehouse with its area set; otherwise `saveShipping` refuses
`OWN_DELIVERY_NOT_READY` with `missing` naming `plan`, `rider` and/or `warehouse`. Only turning it on
is refused: when a piece lapses later, checkout stops offering it (below). Nothing checks that the delivery app is in an app store: riders may
install it as an APK (mobile-app/README.md §2, decided 2026-10-22). It is Owner-only, like the rest of Shipping.
**Built on #841** (`shippingSettings`, `saveShipping`, `Warehouse`, `saveWarehouse`; DATA-MODEL §7.12).

Per warehouse that delivers (Settings › Warehouse, a location's form; the merchant's own locations only, never a supplier's):

| Setting | Meaning |
|---|---|
| Delivers with own riders | On or off (`ownDelivery`); needs the warehouse's map pin (#815) and its area: `saveWarehouse` refuses `DELIVERY_AREA_REQUIRED` without them, including a save that takes either away while it delivers |
| Delivery area | Kilometres from the pin, straight line, 1–50 (`deliveryRadiusM`, in metres) |
| Rider distance | Kilometres from the pin within which online riders are offered an order, 1–50, default 5 (`riderRadiusM`, in metres; #841) |
| Fee | What the customer pays, in the store's currency (`deliveryFeeAmount`); required while it delivers; Shipping's "free over" rule applies to it as to every method, and in another currency it is converted as Shipping's own amounts are. A market's delivery charge replaces only the flat rate (decided on #841) |

A supplier's location never delivers: a supplier sending these fields is refused `INVALID_INPUT`, and
it reads them as null.

Store-wide: **offer to riders** when the order is placed, or when the merchant marks it ready
(`dispatchWhen`, default when ready), and **minutes before the merchant is alerted** when nobody
accepts (`offerMinutes`, 1–30, default 5).

**At checkout** (Shop API `cart.shippingOptions`, built on #841):

1. The address has a pin (#814). An address with no pin is outside every area. The shop app
   always asks for a pin; the storefront's is optional, so a storefront shopper who skips it
   gets the courier.
2. Own delivery is offered when the store has it on, the plan's `own_delivery` is on, a rider is
   active, the address is one Shipping delivers to (with "only postcodes I upload", its postcode
   is listed), and the pin is inside the area of a delivering warehouse that holds every line of the
   cart, the nearest such warehouse taking it. "Holds" means its free stock (on hand less reserved)
   covers each tracked line the store owns; a product that tracks no stock counts as held anywhere, and
   a to-store supplier's lines are left out (decided on #841). Its option is `own_delivery`, at the
   warehouse's fee, with no text and no days: the storefront words it. The courier and flat-rate
   options are then not offered.
3. Otherwise the existing options apply, unchanged.
4. Pickup, when on, is offered in both cases.
5. **At placement the engine runs the same rule again** on the address pin and the stock it holds,
   and takes the option, warehouse and fee from that, never from the client. An own-delivery option
   the rule no longer gives is refused `SHIPPING_UNAVAILABLE`, as any option no longer offered is
   (`engine/modules/cart/rules.ts`). The store's own lines are held at that warehouse, at placement
   or, for a card, when paid; one it can no longer hold at placement is refused `SHIPPING_UNAVAILABLE`
   too. The warehouse is kept on the cart and the order (`delivery_warehouse_id`) and never shown to
   the shopper.

Distance is straight-line (haversine) in SQL on the pins, in `shop_delivering_warehouse()` (§11).

Own delivery takes the store's own part of an order, and a to-store supplier's lines once handed
over. An order with a to-shopper supplier's lines is not offered own delivery (decided 2026-10-22):
those lines travel with the supplier's courier, and one order would arrive in two ways.

---

## 3. Dispatch

An order placed with own delivery gets a **delivery** (DATA-MODEL §7.12) once it can ship: at
placement for cash on delivery, at payment otherwise (a bank transfer waits for `markOrderPaid`; unlike dispatch,
`shipItems` also allows unpaid bank transfers). With the store's "when ready" setting it waits in `packing` until someone with
`orders.fulfil` marks it **ready for pickup** (`markReadyForPickup`); with "when placed" it starts
at `searching`. The setting is read when the delivery is created.

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

**States**. Every transition, and who makes it (built on #842 and #843):

| From | To | By |
|---|---|---|
| `packing` | `searching` | Ready for pickup (merchant) |
| `searching` | `assigned` | a rider accepts |
| `searching` | `unassigned` | nobody accepts in the store's minutes, or nobody in range |
| `unassigned` | `searching` | Offer again (merchant): the same delivery, a new offer round |
| `unassigned` | `assigned` | assigned by hand (merchant) |
| `assigned` | `searching` | hand back (rider): a new offer round without that rider; also automatic when the merchant suspends, removes or erases that rider |
| `assigned` | `picked_up` | picked up (rider) |
| `picked_up` | `delivered` | the right code (rider); or the merchant with a reason when the code is locked or unconfirmed |
| `picked_up` | `failed` | not delivered (rider); the merchant for an unconfirmed code; or the merchant **recalls** it (`cancelDelivery` on a picked-up delivery, reason `recalled`): the rider is told by push to bring the parcel back, and their access to the customer's details and the code end at once |
| `packing`, `searching`, `unassigned`, `assigned` | `cancelled` | the merchant cancels the delivery, or the order is cancelled. If the order stays open, Offer again makes a new delivery for it, as after `failed` |

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

**Handover code** (built on #843; the customer's view of it is SH 5). Four digits, made when a rider is assigned, shown only to the
order's customer, and only where they are signed in or hold the order's link: the shop app's
order screen and the website's order page. **No push or email carries it**: the "on the way"
push and email say to open the order to see the code, so a lock screen or a forwarded email never
shows it (that wording comes with SH 5, once the order shows the code; until then they say only that it is on its way). The rider never reads it. A wrong code is refused (`WRONG_CODE`); after 5 wrong codes
the delivery is locked (`CODE_LOCKED`) and only the merchant can mark it delivered, from the
order, with a reason. The code is kept encrypted and deleted when the delivery ends.

A new code is made at every assignment: when a rider hands a delivery back, its code is deleted and
the next rider's assignment makes a fresh one, so a code told to the first rider is useless.

**Delivered without signal** (built on #843; the app's side is DL 9). The app keeps the step and the code the rider typed in
secure storage, deleted once sent, and allows one attempt while offline; the server checks it when
it arrives, as one try. If the code is wrong, the delivery stays `picked_up`, marked
`code_unconfirmed_at`, and the API answers `CODE_UNCONFIRMED`: the rider's app says the code
didn't match and the store will confirm, and the merchant is alerted by email and on the order.
The merchant then marks it delivered with a reason, as for `CODE_LOCKED`, or not delivered. The
cash collected sent with it is kept on the delivery, and the order becomes paid only when the
delivery becomes `delivered`. With signal the rider retries at the door as usual.

**The minute sweep**: one Cron trigger every minute in `src/jobs`, per store, that
(a) moves `searching` deliveries older than the store's minutes to `unassigned` and queues the
merchant's email (step 3), and (b) deletes `rider_position` rows older than 10 minutes and clears
those riders' `online_at`. It is idempotent: a second run in the same minute changes nothing.

**Online.** A rider switches **Online** in the app. While online the app sends its position every
60 seconds; a rider with no position for 10 minutes counts as offline, and the
minute sweep (above) then deletes their position and clears their online state, so a phone
that dies or loses signal for good leaves no point behind.

**DL 5 built on #842 (2026-10-26).** Delivery creation, Ready for pickup, round-based broadcasts,
accept/decline, manual assignment, cancellation before pickup, online state and position reporting are built.
Pickup and delivery proof are built on #843 (below); customer tracking remains SH 5.

| Decision | Rejected | Why |
|---|---|---|
| Going online sets availability; the app immediately reports its first position. Broadcast eligibility requires a position less than 10 minutes old | Adding coordinates to setOnline | Keeps the two API operations and never offers work without a current point |
| Sign-out hands back assigned work and is refused with RIDER_HAS_PARCEL after pickup; stale positions clear availability but retain assignments | Automatic hand-back on signal loss | Losing connectivity must not silently reassign an existing parcel |
| The merchant's currentDeliveryId chooses picked-up first, otherwise the oldest assignment, with id as tie-break | Refusing manual assignment to busy riders | Manual assignment may give a rider multiple deliveries |
| order.delivery is the latest attempt; its steps include earlier attempts | Hiding cancelled attempts | Keeps retry history visible |

The offer job is outbox kind delivery.offer, keyed by delivery and round. Busy riders are omitted
from broadcasts and refused ON_DELIVERY on acceptance; manual assignment may choose a busy or offline
active rider, only from unassigned. Offers show postcode and city, total item quantities and rider-to-warehouse
distance in metres. Notification distances use the store's units and locale. Cash due is the COD payment
amount after any gift card contribution, in the order currency. Preview orders get no delivery.
The dispatch setting is read at delivery creation. Ready is refused unless packing.
Going offline closes open offers and hands assigned deliveries back in a new round without that rider;
it is refused after pickup. A report while offline is refused. Reports allow 30 seconds of clock skew,
ignore older points, and permit one write per ten seconds of server time. Positions never enter logs.

Each round without a rider queues one email to active merchant members with orders.fulfil, in the
partner's look: "Nobody took order {number}", with the portal order link. It waits for a live portal host.
Closed offers receive a silent taken update. Manual assignment and cancellation notify the rider.
A person with orders.read (a member, or staff impersonating one) sees the rider's phone on the order; a support session, an API key and an app grant get the
rider's name and vehicle only (decided 2026-10-26 on #920, replacing #842's decision 6).

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
| `deleteMyAccount` | The rider's own account only, as the merchant's erase (§5): `assigned` deliveries handed back, refused `RIDER_HAS_PARCEL` while carrying a `picked_up` one, sessions, devices and position deleted, logged with the rider as actor (Apple 5.1.1(v)). Until erasure is built (#874) it is the merchant's removal (decided on #839) |
| `setOnline(online)`, `reportPosition(lat, lng, accuracy, at)` | Being available; the latest position (§7) |
| `offers(first, after)` | This rider's open offers, newest first, keyset-paged: `first` 20 by default, at most 50; each with the warehouse, distance, number of items and the customer's area (never the address before accepting) |
| `acceptOffer(id)`, `declineOffer(id)` | §3 steps 1–2; a lost race answers `TAKEN` |
| `deliveries(state, first, after)` | This rider's deliveries, newest first, keyset-paged: `first` 20 by default, at most 50. A past delivery shows its date, state, warehouse, the customer's area name and the fee, never the customer's name, phone, address or pin |
| `delivery(id)` | One delivery: warehouse address and pin, the lines and quantities; the customer's area name and the cash to collect. **Only once the rider has picked it up** (`picked_up`, and still theirs) also the customer's name, phone, address, pin and note, so accepting and handing back never reveals a customer. Once it is delivered, failed, cancelled or recalled, none of the customer's details are returned again |
| `handBack(id)`, `markPickedUp(id)`, `markDelivered(id, code, cashCollected, at, key)`, `markFailed(id, reason, note, at, key)` | §3 steps 4–5. `markDelivered` refuses a wrong code (`WRONG_CODE`, then `CODE_LOCKED`), and for cash on delivery a missing `cashCollected` (`CASH_NOT_CONFIRMED`); a wrong code arriving late answers `CODE_UNCONFIRMED` (§3, Delivered without signal). The last two may arrive late from a phone that had no signal (decided 2026-10-22, delivery/FIRST-RELEASE.md §1): `at` is when the rider did it, accepted between pickup and now and kept as the step's time; `key` makes a resend do nothing twice |
| `registerPushDevice(token, platform)`, `unregisterPushDevice(token)` | The Expo push token for this phone, and forgetting it (§6) |

Every list in this API and in §8 is keyset-paged with a stated maximum, never above the scoped
layer's `maxPageSize` (100). A rider reads and writes only their own offers and deliveries, of their own store. Every write
goes to the activity log with actor kind `rider` (LOGGING.md §4), the delivery as target.
Sign-in is rate-limited per number and per address, as the Shop API's codes are.

**Built on #839:** the API itself (`src/apis/delivery`, `schema/delivery.graphql`), with `requestCode`, `signIn`,
`signOut`, `me`, `updateProfile` and `deleteMyAccount`; on #840 (DL 3) `registerPushDevice` and `unregisterPushDevice`;
dispatch is built on #842 (DL 5); pickup, proof and completion on #843 (DL 6), below.

**Built on #843 (DL 6), decided on it:**

- **Pickup** ships every unit not yet sent as `local` shipments from the delivery's warehouse, through the function
  `shipItems` uses: stock out with the rider as the movement's actor, holds given back, the parts' and order's states,
  the shopper's "on its way" email and `order.shipped` webhook. It is
  refused `NOT_ENOUGH_STOCK` as `shipItems` is, and `NOT_HANDED_OVER` while a to-store supplier's lines are not all
  with the store (§2). A retry after `failed` finds the order's `local` shipment and writes none.
- **The code** is sealed under the credentials key (`CREDENTIALS_KEK`) bound to its delivery's id; without the key
  an assignment answers `UNAVAILABLE`. A merchant's assignment and recall run in system scope for it (DATA-MODEL §7.12).
- **`markDelivered`**: `WRONG_CODE` for tries 1 to 4, `CODE_LOCKED` from the fifth; each wrong try is logged
  (`delivery.code_refused`). `at` from pickup to 30 seconds past the server's time, else `INVALID_INPUT`; a step
  more than 2 minutes old counts as sent late. A resend with the same `key` answers what the first did and changes
  nothing. A wrong code sent late leaves `code_unconfirmed_at` and emails the merchant (`delivery-code-unconfirmed`);
  after that the rider's steps answer `CODE_UNCONFIRMED` and the store moves it on.
- **`markFailed(id, reason, note, at, key)`**: `no_one_home`, `refused`, `wrong_address` or `other` with a note (1–500);
  the customer gets a push and the `order-not-delivered` email.
- **`deliveries`** takes a list of states and counts `deliveredToday` and `deliveredThisWeek` in the store's time zone,
  the week starting on the first day of the store's language and region (`en-US` Sunday, `en-GB` Monday; Monday where
  the runtime can't tell; decided 2026-10-26 on #843). The area and the fee are copied onto the delivery when it is
  made, so a past delivery shows them without the order.
- Refusals: `NOT_ASSIGNED` (hand back or pick up a delivery not assigned), `NOT_PICKED_UP` (a last step on one not in
  transit), `CASH_NOT_CONFIRMED`; another rider's or store's delivery is `NOT_FOUND`.

- **The session** comes back from `signIn` once and goes in as `Authorization: Bearer <token>`: hashed in
  `rider_session`, 30 days from last use, ended by `signOut`, suspension, removal and `deleteMyAccount`. A token of
  another store, an ended or expired session, a suspended or removed rider, a shopper's session and a portal cookie
  all read as signed out: `me` is null and every other field answers `UNAUTHENTICATED`.
- **`requestCode`** answers `true` at once. The look-up, the code and its text run after the answer (the Worker's
  `waitUntil`), so their timing can't show who is invited. Only the per-address limit is said (`RATE_LIMITED`), as it
  says nothing of the number. A number past its 3 codes, a store past its 50, an uninvited, suspended or removed
  number, and any number while the plan has no `own_delivery` all get `true` and no text. The text is the shoppers'
  sign-in wording (`code.shopper_sign_in`), so partners register no new template (THIRD-PARTY-ACCESS §4).
- **`signIn`** answers `CODE_REFUSED` for a wrong, spent, expired or locked code (5 tries), for a number with no
  code, and once the plan has no `own_delivery`; `RIDER_SUSPENDED` for a rider suspended after the code was sent.
  An invited rider's first code makes them active (`rider.joined`).
- **`updateProfile`** sets the name (1–120), vehicle type, vehicle number (up to 20) and photo together. The photo
  is uploaded first as the raw image to `POST /delivery-api/assets`, with the same checks as the portal's uploads,
  and only an image the rider uploaded can be named (`PHOTO_NOT_FOUND`). A rider uploads at most 10 photos in
  24 hours, then `RATE_LIMITED` (429). The log records which fields changed, never their values.
- **`deleteMyAccount`** removes the rider as an Owner's removal does (§5): sessions ended, phone erased, name kept,
  the number free to be invited again. Every photo the rider uploaded goes too, replaced ones included: the rows in
  the transaction, the files from R2 once it commits. One the store has put on a product since stays, as the store's.
- **`registerPushDevice`** takes an Expo push token (`ExponentPushToken[…]` or `ExpoPushToken[…]`, else `INVALID_INPUT`,
  never echoed) and `ios` or `android`. A token the store already holds for another rider, customer or order moves to
  this rider. Only a phone new to the rider, or moved to them, is logged (`rider.push_device_registered`, the platform,
  never the token) and gets the confirmation push (§6); the app registering again at each launch only moves
  `last_seen_at`. **`unregisterPushDevice`** deletes the rider's own phone (`rider.push_device_removed`) and answers
  `true` for any other token, so it says nothing of another's. Sign-out, suspension, removal and `deleteMyAccount`
  delete every phone of the rider; another phone still signed in registers again at its next launch (decided on #840).

---

## 5. Riders

- **Invited by the Owner** (Store API `inviteRider(name, phone)`, built on #838) from **Settings › Riders**, a new
  tab, Owner only like the rest of Settings (store/FIRST-RELEASE.md §15), on the web and in the
  merchant app. The rider gets a text through the outbox, sent through the
  partner's SMS account (MSG91 or Twilio) like every code, with the store's name and the store's
  delivery app link (the fixed message `rider.invited`, in English, THIRD-PARTY-ACCESS §4). Until the
  app links exist (DL 15, #852) the link is `https://{slug}.{SHOP_DOMAIN}/app/delivery.apk`, made only
  by `deliveryAppLink`; without a shop domain the invitation is refused `UNAVAILABLE`. A number
  already among the store's riders is refused `PHONE_TAKEN`; a removed rider's number is free again.
  `resendRiderInvitation` texts an invited rider again while the plan has own delivery: at most 3
  texts in 24 hours, the invitation included (counted from the activity log), then `RATE_LIMITED`.
- **Signing in is joining** (built on #839, §4). The invited number signs in with a code and the invitation is taken;
  there is no link or token. A number never invited gets the same answer as a wrong code, so the
  API never reveals which numbers a store has invited (AGENTS.md "Security"). A code is kept only
  for an invited or active rider's number, and code rows are deleted a day after they expire.
- **Profile:** name, photo, vehicle type (bike, scooter, car, bicycle, on foot), vehicle number.
- **The merchant** sees each rider's status (invited, active, suspended), online now, current
  delivery and deliveries done, and can **suspend** an active rider, **restore** a suspended one
  (built on #838 with the list and removal; deliveries done reads 0 until DL 6; current delivery is built on #842) (sessions end at once; an `assigned` delivery
  is handed back to the other riders; refused `RIDER_HAS_PARCEL` while they carry a `picked_up` one,
  which the merchant recalls first) or **remove** (the same rules; the row
  stays, so past deliveries keep their rider; the phone is erased, AGENTS.md "Data").
- **Export and erase** *(proposed, built on #874)*: the Owner can export one rider's data (profile,
  deliveries with dates, states, warehouse and the customer's area name only, sign-in times) as an
  export job, and **erase** a rider: removal, then "Former rider" in place of their name in past
  deliveries and the activity log's labels (LOGGING §8), with their sessions, devices and position
  deleted. A rider's own Delete my account does the same, under the same rules as suspension:
  their `assigned` deliveries are handed back, and it is refused `RIDER_HAS_PARCEL` while they
  carry a `picked_up` one, so a parcel in transit always keeps its rider.
- **Sessions** last 30 days from last use, like customers' (DATA-MODEL §3.4), one per phone.
- **A rider belongs to one store.** The same person delivering for two stores has two accounts
  and two apps, as a customer does.
- **Plan:** the number of riders is a plan limit (§9): invited and active riders count, suspended
  and removed ones don't.

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

**Built on #840 (DL 3), #842 (DL 5) and #843 (DL 6):** the pipe, the test event, the rider's messages and the customer's
picked up, delivered and not delivered (`order.*`, to the customer, or to a guest's order), which reach a phone once SH 5
registers the shop app's devices. The merchant's emails for nobody accepted and an unconfirmed code are built.

- **Rider messages** (`core/push.ts`): `rider.notifications_on`, `rider.offer` (a distance, never an address), `rider.assigned`,
  `rider.cancelled`, `rider.recalled` (bring the parcel back), and `rider.taken`, which is silent: the app only refreshes its offers.

- **The test event** is a confirmation, "Notifications are on for {store}", queued by `registerPushDevice` in its own
  transaction when a phone is new to the rider or moved to them.
- **An outbox `push` row** names a subject (rider, customer or guest order) and a message; its data is only
  `{ kind, deliveryId | orderId }`. The deliverer sends the title and body, in the store's language (English until a
  second exists), to every phone of the subject in that store, 100 a call, with an 8-second timeout. No answer, a 429,
  a 5xx or a refused access token is retried by the relay with its backoff up to its attempt limit; any other refusal
  gives the row up under Expo's code. Once sent, the payload keeps only the message.
- **Dead tokens**: a ticket answered `DeviceNotRegistered` deletes its phone at once. The ticket ids go into a
  `push.receipts` row due 15 minutes later (ticket and phone ids, never a token), which reads Expo's receipts, deletes
  the phones answered `DeviceNotRegistered`, and waits again for receipts not ready until a day after the send.
- **Without `EXPO_PUSH_TOKEN`** pushes wait in the outbox. Locally `PUSH_LOCAL=1` prints each push in the `pnpm dev`
  terminal, to its subject and never its token (THIRD-PARTY-ACCESS §2.13, §8.1).

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
| Own delivery in `shippingSettings`, the warehouse's delivery settings in `saveWarehouse` (§2; built on #841) | As those operations today (Owner) |
| `riders(first, after)` (50 by default, at most 100), `inviteRider`, `resendRiderInvitation`, `suspendRider`, `restoreRider`, `removeRider`, `exportRider` (a job), `eraseRider` (§5) | New `riders.manage`: Owner |
| `order(id).delivery`: state, history, rider, position while picked up; the failed reason and note, the rider's cash claim, and whether the code is locked or unconfirmed (#843) | `orders.read` |
| `markReadyForPickup(orderId)` (§3) | `orders.fulfil` |
| `assignDelivery(deliveryId, riderId)`, `offerDeliveryAgain(deliveryId)`, `cancelDelivery(deliveryId)` (before pickup it cancels; after, it recalls, §3), `markDeliveryDelivered(deliveryId, reason, cashReceived)` (a locked or unconfirmed code, §3; cash below) | `orders.fulfil` |

**A merchant-confirmed cash-on-delivery delivery** (built on #843): `markDeliveryDelivered` then requires
`cashReceived`, the merchant's own statement that the cash reached the store. `true` marks the order
paid through the existing mark-paid path, so it also needs `orders.mark_paid` (Owner, Manager;
ACCESS §5.1; `FORBIDDEN` without it), and the activity entry names the merchant and the reason; the rider's own
claim, if one was sent late, stays on the delivery (`cashCollectedAt` on the order). Any other delivery answers
`CODE_NOT_LOCKED`. `false` marks the delivery delivered and leaves the order unpaid until someone
marks it paid as today. A prepaid order ignores the argument.

A supplier never sees riders, positions or a delivery: own delivery carries only the store's
lines (§2), so a supplier's `orders.fulfil` (ACCESS §5.2) never reaches these actions; they
check the merchant side as well as the permission (ACCESS §5.1). A support session, an API key or an app grant reads them as `orders.read` allows, never a rider's phone.

Built on #838: `riders`, `inviteRider`, `resendRiderInvitation`, `suspendRider`, `restoreRider` and
`removeRider`. All of them are refused to a support session (`BLOCKED_FOR_SUPPORT`), since the list
holds the riders' phones, and to API keys. Each write is in the activity log with the rider's name
as its target label, never the phone (LOGGING §3).

---

## 9. Plans

Three plan keys (SAAS.md §6.1), added on #838 (migration 0359), off and 0 in every existing plan:

- `own_delivery`, on/off, with **riders** as a limit: both enforced at `inviteRider`, refused
  `PLAN_LIMIT` with `key`, `limit` and `unlockedBy` like every plan limit;
- `own_apps`, on/off: the store's shop and delivery apps (mobile-app/README.md), **Planned** until
  the apps are built.

**Enterprise only, set up by hand** (decided 2026-10-22): both are off in every listed plan, and
DripFunnel staff turn them on for one store, with its riders limit, as that store's override in the
admin console (`store_limit_override`, SAAS.md §6.1), once the merchant's Enterprise arrangement is
agreed. There is no Enterprise plan on the pricing page and nothing to buy in the portal.
**Not yet possible** (#838): `store_limit_override` holds amounts only and is set from the partner
console, and the admin console has no override. So a store can be given a riders limit, but
`own_delivery` and `own_apps` can't yet be switched on for one store; that needs a follow-up card.

---

## 10. Testing

- The isolation matrix (ACCESS.md §11.1) gains these rows, each refused:
  - **Delivery API:** another store's rider; a removed or suspended rider; a rider reading or
    acting on another rider's offer or delivery; a rider reading the customer's name, phone,
    address or pin before pickup, after the delivery ends, or after handing it back; a shopper token or a portal session on the
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
    for another store's rider; the export holds no customer address or phone; `deleteMyAccount`
    reaches only the calling rider's own account.
  - **Merchant confirmation:** `markDeliveryDelivered` with `cashReceived: true` refused without
    `orders.mark_paid`, and refused without `cashReceived` on a cash-on-delivery order.
- Suspending or removing a rider with an `assigned` delivery offers it to the others in a new round;
  with a `picked_up` one it is refused `RIDER_HAS_PARCEL`. The rider's own Delete my account follows
  the same two rules.
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
- ~~Distance in SQL (haversine on the pins) or PostGIS on Neon?~~ Haversine in plain SQL (decided on #841):
  PostGIS isn't installed anywhere, and a new extension would make `scripts/migrate`'s extension check refuse to
  migrate until every database has it; haversine is enough for one store's warehouses and riders.
