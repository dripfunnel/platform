---
'@dripfunnel/storefront-core': minor
---

A product's saved size chart now shows on its page (#1326). `useProduct().product.sizeChart` carries the chart the Shop API returns (name, unit, measurements and a row of values per size), or null when the product has none. The new `<SizeChart>` (`ui/headless`) draws a "Size chart" link and, once chosen, the table in a modal `<dialog>` that closes on Escape and returns focus to the link. Core styles the modal from the `--df-sealed-*` tokens and loads it on the first click; the theme styles only the link. The starting themes place it under the options.
