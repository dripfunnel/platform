---
'@dripfunnel/storefront-core': minor
---

The publish gate's blocking-time refusal now shows its three timings and the CPU slowdown they were taken at, and `PageWeight` carries that slowdown as `cpuSlowdown`, so a refusal on a slow runner can be told from a heavy theme.
