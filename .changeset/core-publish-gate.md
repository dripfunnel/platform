---
'@dripfunnel/storefront-core': minor
---

The publish gate's suites in `./guard` (storefront ARCHITECTURE §4.2 step 3): `runGate` and one function per check (`validator`, `contracts`, `sealed`, `checkout`, `axe`, `budgets`, `no-js`, `crawl`, `content`, `visual-diff`, `edge-cases`) over what the build image's check step saw of a build, each reporting pass or fail in plain words; the catalogue snapshot a publish builds from (`catalogueSnapshotSchema`) and the edge-case catalogue (`edgeCases`). The route contract gains `routeAddresses`, where each core route lives on a live site, and `requiredParts` takes `priced: false` for a page core gave no price to show. `./testing` exports `sealedProblemWords`.
