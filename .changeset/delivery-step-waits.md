---
'@dripfunnel/storefront-core': patch
---

No theme has to change (#1145). `useCheckout` leaves the delivery step out of `steps` until the cart has a delivery address, so a store with one delivery option no longer shows the step before the address and then drops it.
