---
'@dripfunnel/storefront-core': patch
---

The upgrade now puts the "Size chart" link under the options of a Classic product page that still has the shipped markup (#1462): the `coreUpgradeNotes` entry for 0.14.0 gains codemods that add `<SizeChart>` to `ProductPage.tsx` and its `.sizeLink` style to `product.module.css`. A store made before 0.14.0 never had the link, because an upgrade changes a theme file only through a codemod. It finds that place in either shipped markup: the stock line as it was, or as #1278 ships it (shown only when there is stock to say), and runs once in each. A theme that changed that markup places `<SizeChart chart={product.sizeChart} />` itself.
