---
'@dripfunnel/storefront-core': minor
---

The publish gate's report now passes when only its advisory checks fail: budgets, no-js and crawl, and the visual diff unless the publish must keep the look (new exports `advisoryChecks` and `blocksPublish`). The failing checks and their words stay in the report, so a build that misses a budget can go live with them as suggestions.
