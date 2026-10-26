---
"@dripfunnel/storefront-core": minor
---

Checkout applies the sole delivery option for the shopper and omits the delivery step when a store offers exactly one shipping method; with several the shopper still chooses, and with none the step explains it can't be delivered. The decision lives in the checkout controller, so every theme and the baseline fallback behave the same.
