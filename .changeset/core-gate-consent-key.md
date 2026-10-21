---
'@dripfunnel/storefront-core': minor
---

`consentStorageKey` (where the shopper's consent choice is kept) and `settleMs` (how long a sealed component's own check waits before its second look) are exported, so the publish gate's check step uses core's values instead of restating them.
