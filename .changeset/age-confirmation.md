---
'@dripfunnel/storefront-core': major
---

A cart with an age-restricted product now asks "Before you order: please confirm you're 18 or over." at Review (#1443). New sealed `<AgeConfirmation needed checked onChange t />` (part `age`); `useCheckout()` gains `needsAgeConfirmation`, `ageConfirmed` and `confirmAge`, and `<PlaceOrder>` stays disabled, and `place()` sends nothing, until the box is ticked. The baseline checkout places it. A theme that doesn't place `<AgeConfirmation>` still gets the box: `<PlaceOrder>` draws it just above the button, so no store's checkout is locked out.

To choose where it sits, a theme places `<AgeConfirmation needed={c.needsAgeConfirmation} checked={c.ageConfirmed} onChange={c.confirmAge} t={t} />` above its `<PlaceOrder>`; it renders nothing for a cart without an age-restricted product. Classic does this.

This is a major (docs/code/ARCHITECTURE.md §5): a new box appears in every store's checkout for such a cart, and `<PlaceOrder>` is disabled until it is ticked, which changes a hook's documented behaviour and the stores' look. No store is locked out, since `<PlaceOrder>` draws the box for a theme that doesn't place it, but it reaches stores with these upgrade notes at the merchant's next publish.
