---
'@dripfunnel/storefront-core': patch
---

The order summary lists Delivery above the discounts (#1679). A "Free delivery" saving was shown before the "Delivery" charge it removes; the summary of the cart page, the checkout and a placed order now reads Subtotal, Delivery, each discount, Tax, Total. The wording, amounts and total are as before. No change to the package's API or to any theme. A patch by an exception to docs/code/ARCHITECTURE.md §5 (the order is a look in every store), chosen on #1715 for the card's assignee, 2026-11-25, to be confirmed by the card's owner.
