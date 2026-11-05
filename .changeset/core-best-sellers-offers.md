---
'@dripfunnel/storefront-core': minor
---

Adds `useProducts({ sort: 'best-selling' })`, the store's best sellers by units sold over the last 90 days as the platform ranks them hourly, and `useOffers()`, the store's automatic offers on now (name, description, end, and the products or collections they apply to; never a discount code), each dropped the moment it ends. A listing's own sorts (`SortKey`) are unchanged. The catalogue snapshot's offline client answers both.
