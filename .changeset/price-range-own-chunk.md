---
'@dripfunnel/storefront-core': patch
---

`<PriceRange>` loads in its own chunk, fetched by the first page that shows it, so pages without a listing no longer download it and stay inside the 1 MB page budget. Its props are unchanged; built HTML has no slider until it loads, and a chunk that fails to arrive leaves the filter out rather than breaking the page.
