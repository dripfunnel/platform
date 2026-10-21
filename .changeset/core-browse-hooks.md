---
'@dripfunnel/storefront-core': minor
---

The browse hooks (#307 part 2). `./theme` gains `useProduct` (versions, options with their availability, the chosen version's price, stock and photos, a version's own address `/products/{slug}/{version}/`, and the market's legal details for `LegalNotices`), `useCollection` (with `/collections/all/` as every product), `useCollections`, `useSearch`, `useProducts` and `useListing` (filters with OR within a filter and AND across, sort and the page's cursor in the address, `fetchMore`), and `useMenu`, the merchant's menu.
