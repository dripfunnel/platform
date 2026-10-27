---
'@dripfunnel/storefront-core': minor
---

The order page shows an own-delivery order's delivery (#859, api/DELIVERY.md §7): `useOrder().order.tracking` (`OrderTracking`, with `TrackingStep` and `TrackingState`, exported from `/theme`) gives the steps reached with their times in the store's time zone and the steps still to come, and, only while a rider is assigned or has the order, the rider's first name, vehicle and a `tel:` link to call, and the handover code ("Give this code to your rider…"); once the delivery ends, the steps alone. Core words all of it (`order.delivery.*` in its messages), so every theme says the same, and asks the Shop API for `delivery { state steps rider handoverCode }` only: never the rider's position, the arrival estimate or a map, and not the rider's photo, which the website cannot load yet. `tracking` is optional on `Order` and null for any other order, so a theme that does not show it, and a courier order, read as before. The baseline theme lays it out in `DeliveryTracking`.

`Link` now also takes `tel:` and a dialable number (an optional `+` and 6 to 15 digits) so the rider can be called; any other `tel:` address, `sms:`, `mailto:` and every other scheme are still rendered as text, as before.
