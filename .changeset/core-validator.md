---
"@dripfunnel/storefront-core": minor
---

The validator, `@dripfunnel/storefront-core/guard` (#480): `validateChange(files, context)` refuses a theme change whole when any file breaks a rule of storefront ARCHITECTURE §3.4, each problem naming the file, the line, a rule id and a plain-words message. This part covers the file allowlist with its caps (200 files, 100 KB a file, 2 MB in all) and symlinks; the content rules (strict JSON, every file and key in every language the store offers, no price, scarcity, urgency, rating or countdown claim, no copied brand field); and `routes.json` against the new `themeRoutesSchema`.

The validator's code rules (#480 part 2): imports from the allowlist only, no browser globals however they're reached, no walking the DOM, the JSX element and attribute allowlists, no text, address or brand field in code, and `t()` keys written out and present in every language. The new `@dripfunnel/storefront-core/theme` entry is what a theme imports: `useStorefront` and the required components.

The validator's CSS Module rules (#480 part 3): every selector starts with a module class; no `:global`, `@import`, `@font-face` or nested rules; `url()` only for the store's media ids (the new `mediaIds` in the context); no `df-` class, element or core attribute; z-index at most 99; transitions and keyframes only of transform, opacity and filter; no words in `content`.
