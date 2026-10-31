---
'@dripfunnel/storefront-core': minor
---

Search suggestions (#1070): `SearchField` takes an optional `suggest`, how many products (up to 4) to show under the box while the shopper types. Once typing pauses (250 ms, two letters or more) core asks the Shop API for the matching products and lists each with its picture, name and sealed price, linked to the product, then "See all results for “…”", or says "No products match “…”." (core's `search.suggest.*` messages). The box is a combobox: arrows move, Enter opens the highlighted product or the results, Escape closes, and a failed lookup hides the list without stopping the search. The theme styles the list through its form's class. Nothing changes for a theme that leaves `suggest` out.
