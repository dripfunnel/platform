---
'@dripfunnel/storefront-core': minor
---

`BaselineCheckout`: core's own checkout, in core's words and look, which `CheckoutBoundary` hands a shopper to once the theme's checkout throws. `smokeShop`, `smokeShopper`, `smokeProductSlug` and `smokeProblems` (from `./guard`): the checkout smoke test's offline Shop API, with a test product and cash on delivery in test mode, the test shopper's details, and the words for a test purchase that didn't complete. A problem a boundary catches before the page has set its reporter (a checkout that throws on its first render) is held and sent once it is, instead of being lost.
