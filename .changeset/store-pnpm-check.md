---
'@dripfunnel/storefront-core': minor
---

`dripfunnel-check` (#974), a store repo's `pnpm check`: the validator over what a push would carry (the files git holds, staged changes included), on a developer's machine, before a push to `main` goes live. It prints each problem as `file:line  rule  message`, names theme files never added to git, exits 1 on any problem, and names what only the build checks: that `content/` holds exactly the store's languages, copying the brand's fields, a CSS `url()`'s media id and a custom path already in use. The validator now finds its own files with `fileURLToPath`, so it runs on Windows as well as in the build image. `./guard`'s exports are unchanged.
