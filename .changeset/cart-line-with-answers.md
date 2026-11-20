---
'@dripfunnel/storefront-core': minor
---

`useCart()`'s `setQuantity(versionId, quantity, lineId?)` and `remove(versionId, lineId?)` take the id of the line to change (#1641). A line with answers to the product's questions can only be named by its id, so its **+**, **−** and **Remove** were refused and the cart said "That change didn't go through"; the optimistic change now also touches only the line named. Called without a `lineId`, both behave as before, for a version's line without answers. The starting themes' cart views pass `line.lineId`, key their lines by it, and place **Edit** at the left under the answer through a new `edit` class, where it sat across the whole column.
