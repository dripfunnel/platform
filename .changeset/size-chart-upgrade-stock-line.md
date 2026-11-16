---
'@dripfunnel/storefront-core': patch
---

The 0.14.0 upgrade's "Size chart" link codemod (#1462) also finds a Classic product page whose stock line is #1278's, shown only when there is stock to say, and puts the link under the options there too (#1532). It runs once in either markup; a theme that changed that markup still places `<SizeChart chart={product.sizeChart} />` itself.
