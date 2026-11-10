---
'@dripfunnel/storefront-core': patch
---

`<PriceRange>` loads in its own chunk, fetched by the first page that shows it, so pages without a listing no longer download it and stay inside the 1 MB page budget. Its props and behaviour are unchanged; built HTML has no slider until it loads.
