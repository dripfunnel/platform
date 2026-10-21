---
"@dripfunnel/storefront-core": minor
---

The runtime walls (#481 part 2). `storeCsp` and `studioCsp` build a store's and the studio frame's Content Security Policy from a page's `inlineHashes` (never a nonce), and `pageHeaders` gives each HTML file of a build its header for the manifest; `installTrustedTypes` creates the `df-core` and narrow `default` policies, and analytics load their scripts through `df-core`. `<Link>` (now in `./theme`) opens another host in a new tab with `noreferrer noopener` in the studio frame, whose render mode is the new `studio`, and never carries a `javascript:` or `data:` address. `SectionBoundary` falls back to the baseline section and `CheckoutBoundary` switches a shopper to the baseline checkout for the visit, each reporting the failure.
