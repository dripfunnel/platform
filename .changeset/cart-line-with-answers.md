---
'@dripfunnel/storefront-core': minor
---

A line with answers to the product's questions can change quantity and be removed (#1641). Its **+**, **−** and **Remove** were refused by the engine, which finds a version's line without answers unless it is given the line's id, so the cart said "That change didn't go through". `useCart()`'s `setQuantity(versionId, quantity, lineId?)` and `remove(versionId, lineId?)` now send the line's id. A theme that names no line, such as an existing store's cart view, gets it from core when the version has only that one line and it has answers; two lines of one version are told apart only by a `lineId`, so a theme should pass `line.lineId` and key its lines by it, as the starting themes now do. The optimistic change touches only the line named. The starting themes also place **Edit** at the left under the answer, through a new `edit` class, where it sat across the whole column; an existing store gets that only when its theme is updated.
