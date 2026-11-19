---
'@dripfunnel/storefront-core': major
---

The upgrade's loading skeletons shimmer (#1598): the codemods also give each skeleton block of a Baseline, Classic or category theme a band of the page colour sweeping across it every 1.6 seconds, with the `shimmer` keyframes added to the theme's `theme.css` (Classic: its shop and product styles). Core's reduced-motion rule leaves the blocks plain. No change to the package's behaviour or API. Major because every store's look changes (docs/code/ARCHITECTURE.md §5), so it reaches a live store at its merchant's next publish.
