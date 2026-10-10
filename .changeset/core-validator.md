---
"@dripfunnel/storefront-core": minor
---

The validator, `@dripfunnel/storefront-core/guard` (#480): `validateChange(files, context)` refuses a theme change whole when any file breaks a rule of storefront ARCHITECTURE §3.4, each problem naming the file, the line, a rule id and a plain-words message. This part covers the file allowlist with its caps (200 files, 100 KB a file, 2 MB in all) and symlinks; the content rules (strict JSON, every file and key in every language the store offers, no price, scarcity, urgency, rating or countdown claim, no copied brand field); and `routes.json` against the new `themeRoutesSchema`. The route list gains `contentPage`, `blog` and `blogPost` (SAPI 24).
