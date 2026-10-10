---
"@dripfunnel/storefront-core": minor
---

The validator's code rules (#480 part 2): imports from the allowlist only, no browser globals however they're reached, no walking the DOM, the JSX element and attribute allowlists, no text, address or brand field in code, and `t()` keys written out and present in every language. The new `@dripfunnel/storefront-core/theme` entry is what a theme imports: `useStorefront` and the required components.
