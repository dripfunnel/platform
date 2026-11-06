---
'@dripfunnel/storefront-core': minor
---

`useCheckout` lets a signed-in shopper keep their delivery address: `canKeepAddress` says whether they may, and `saveAddress(address, true)` also saves it to their account (the default when they have none) unless it holds that place already. A refusal, such as the 20-address limit, never holds up checkout. The baseline checkout shows "Save this address to my account", ticked. Themes that pass nothing keep today's behaviour.
