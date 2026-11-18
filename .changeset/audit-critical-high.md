---
'@dripfunnel/storefront-core': patch
---

Dependencies only (#1511). `zod` is raised to `^4.6.7`, which fixes a high-severity advisory in the range below `4.6.6`. The storefront template's `next` pin goes from `^16.3.6` to `^16.4.6`, which fixes 2 critical advisories (remote code execution in the image optimizer and in `use cache`) and 2 high ones; a store repo picks it up through the upgrade bot with this release. No change to the package's behaviour or API.
