---
'@dripfunnel/storefront-core': minor
---

Only adds; no theme has to change. `<StoreLogo className>` shows the store's logo from Site settings › Brand, or its name while it has none, loaded at once and never resized. The store's favicon is now in every page's head (`<link rel="icon">`), on the live site and in the preview; `Head` gains an optional `icon`, which `useHead` never passes on, so the favicon stays the store's.
