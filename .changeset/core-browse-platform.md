---
'@dripfunnel/storefront-core': minor
---

The browser side of browsing (#307 part 1). `./theme` gains the browser hooks (`useLocation`, `navigate`, `useMediaQuery`, `useReducedMotion`, `useInView`, `useScrollProgress`, `usePointer`), `<Image>` and `<Video>` for the store's own media, `useHead`, and the headless `Checkbox`, `Select` and `SearchField`. `StorefrontProvider` takes the page's `address` for a static build and keeps the store's head (noindex outside the live site); `createShopClient` takes `onError`; `PreviewClosed`, `previewClosedCode` and `setRouterBase` serve core's runtime; breadcrumbs show a separator between crumbs.
