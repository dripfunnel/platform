---
'@dripfunnel/storefront-core': minor
---

A listing filters by price and loads on scroll. `useListing` adds `priceBounds` (the listing's lowest and highest price shown, before its filters), `priceRange` and `setPriceRange({ min, max })` (minor units, either end open, kept in the address as `price=min-max-CUR` and ignored in another currency), and `clear` also drops the range. `<PriceRange>` draws the price filter, a two-thumb slider over round prices with a lowest and highest choice under it, styled through `className` and `parts`. `useLoadOnScroll(listing)` gives a ref for an element after the grid; the next page loads as it nears the screen and stops at a page that failed, for the theme's retry. Themes that use none of them keep today's behaviour.
