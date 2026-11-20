---
'@dripfunnel/storefront-core': minor
---

The upgrade brings scroll-loading lists to existing stores (#1570). The release notes gain codemods that rewrite the starting themes' Account › Orders and Blog views, which asked for a "Load more" click, so the next page loads as the end of the list nears the screen, with a "Loading more…" line, a Try again after a failure and the number shown announced, and that turn the "Load more" button of a product grid from before core 0.12.0 into the scroll-loading one. For a theme that changed those views the notes give the migration agent the steps. No change to the package's API: the themes call `useLoadOnScroll` with `useOrders()` and `useBlog()`'s own `loadMore`, `more`, `loadingMore` and `loadMoreFailed`.
