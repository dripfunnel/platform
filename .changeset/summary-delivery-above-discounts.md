---
'@dripfunnel/storefront-core': patch
---

The order summary lists Delivery above the discounts (#1679). A "Free delivery" saving was shown before the "Delivery" charge it removes; the summary of the cart page, the checkout and a placed order now reads Subtotal, Delivery, each discount, Tax, Total. The wording, amounts and total are as before. No change to the package's API or to any theme. This is a patch by an explicit, intentional exception to docs/code/ARCHITECTURE.md §5 (the row order is a look in every store, but the change is backward-compatible), confirmed on #1679 and #1715 on 2026-11-25.
