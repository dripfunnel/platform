---
'@dripfunnel/storefront-core': major
---

A cart with an age-restricted product now asks "Before you order: please confirm you're 18 or over." at Review (#1443). New sealed `<AgeConfirmation needed checked onChange t />` (part `age`); `useCheckout()` gains `needsAgeConfirmation`, `ageConfirmed` and `confirmAge`, and `<PlaceOrder>` stays disabled, and `place()` sends nothing, until the box is ticked. The baseline checkout places it.

Upgrade notes: a theme with its own checkout places `<AgeConfirmation needed={c.needsAgeConfirmation} checked={c.ageConfirmed} onChange={c.confirmAge} t={t} />` above its `<PlaceOrder>`; it renders nothing for a cart without an age-restricted product. Until then, Place order of a cart with such a product stays disabled. Classic does this; Market does not yet.

This is a major: a theme gains a sealed component it must place, and every store's own checkout, and Market, cannot take an order for such a cart until it does.
