---
'@dripfunnel/storefront-core': patch
---

The upgrade brings the starting themes' loading skeletons to existing stores (#1598). The release notes gain codemods that rewrite each loading block of a Baseline, Classic or category theme still holding the shipped markup (cart, checkout, order, account, orders, wishlist, product, collection title, blog, content and the "Loading more products" line) into grey blocks shaped like the loaded page with a shimmer sweeping across them, and add the skeleton classes and the shimmer keyframes to the theme's shop, product and account styles. A theme that draws its own loading states is left as it is. No change to the package's behaviour or API.
