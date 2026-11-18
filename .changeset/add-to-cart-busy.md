---
'@dripfunnel/storefront-core': minor
---

A theme can now tell that Add to cart is working (#1292). `<AddToCart>` and `<BuyNow>` accept a function as their children, which gets `{ busy }` (true from the press until the engine answers), and their button carries `aria-busy` while busy, so a theme can show "Adding…", for example `<AddToCart versionId={id}>{({ busy }) => (busy ? t('shop.product.adding') : t('shop.product.add'))}</AddToCart>`. Nothing else about the buttons changes: they are disabled while busy as before, and a plain child works as it did. This is a minor (docs/code/ARCHITECTURE.md §5): new behaviour, backward-compatible, no theme has to change.

The starting Classic theme uses it, with a spinner that stops turning under reduced motion and its words in `content/en/shop.json` (`shop.product.adding`); a store made before this keeps its button as it is, since an upgrade changes a theme file only through a codemod and this card has none.
