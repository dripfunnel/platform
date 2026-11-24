---
'@dripfunnel/storefront-core': minor
---

A shopper's order gives where it is delivered and its courier parcels (#1691). `useOrder()`'s `order` gains `shippingAddress` (null for a pickup or a digital order) and `shipments`: each parcel with a tracking number, as `{ courier, number, url }`, oldest first, with `url` null where the courier gives no tracking page. Both are optional on `Order`, so a theme that builds one needs no change. The starting themes' order view shows each parcel as "{courier} · tracking {number}", the number linked to its tracking page, and ships `shop.order.shipment` and `shop.order.shipmentNoCourier`; an existing store shows it only when its theme is updated.
