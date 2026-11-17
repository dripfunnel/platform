---
'@dripfunnel/storefront-core': minor
---

A product whose versions differ in price now gives a theme its highest price (#1330): `ProductCard`, `Product` and `ProductPage` gain `maxPrice` (null when the prices are equal, and on the page once a version is chosen), and the sealed `<Price>` takes an optional `to` that draws "{lowest} – {highest}" with one tax label and no compare-at price. `from` stays as it was; a theme that doesn't pass `to` looks exactly the same.
