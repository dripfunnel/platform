---
'@dripfunnel/storefront-core': minor
---

A product's published A+ content (#1351): `useProduct().product.story` holds its modules in the merchant's order (banner, image and text, features, comparison, gallery, in the box, specifications, brand story, FAQ, video; a kind core doesn't know is left out), and `<ProductStory product={…} classes={…} />` from `./theme` draws them in a "More about this product" section, nothing when there are none. Optional: a theme that doesn't place it looks as before.
