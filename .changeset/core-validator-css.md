---
"@dripfunnel/storefront-core": minor
---

The validator's CSS Module rules (#480 part 3): every selector starts with a module class, and `+` or `~` leads only to another of its classes; no `*`, `html` or `body`; no `:global`, `@import`, `@font-face` or nested rules; `url()` only for the store's media ids (the new `mediaIds` in the context); no `df-` class, element or core attribute; z-index at most 99; transitions and keyframes only of transform, opacity and filter; no words in `content`.
