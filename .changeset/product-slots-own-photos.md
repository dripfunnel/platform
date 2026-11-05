---
'@dripfunnel/storefront-core': minor
---

A product's picture comes only from its own photos (#1244). The validator refuses, under the new rule `jsx/product-image` with the file and line, a `<MerchantImage>` inside the render of one product from core's hooks (a function given a `ProductCard` or `Product`, such as a `products.map` callback or a component with a `product` prop), whether written there, under another name, or drawn by a theme component or value used there; and a CSS Module class used there whose rule draws a `url()`, directly or through a custom property holding one. A `<MerchantImage>` beside a product grid, a hero or a banner is unchanged, and so is core's `<Image image={product.photo}>`.

Every shipped theme passes unchanged; a theme that drew a store picture inside a product card is refused until it shows the product's own photo there.
