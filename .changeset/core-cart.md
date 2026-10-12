---
'@dripfunnel/storefront-core': minor
---

The cart (#313 part 1). `./theme` gains `useCart` (the Shop API's active order as the only cart state: lines, codes, offers and totals as the engine answers them; `add`, `setQuantity`, `remove`, `applyCode`, `removeCode` and `buyNow`, each shown at once and replaced by the engine's answer), the sealed `OrderSummary` (part `summary`) and the headless `CodeField`. Core keeps the cart and session tokens the Shop API hands out (`storedShopState`, the runtime's client `state`).
