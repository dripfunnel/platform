---
'@dripfunnel/storefront-core': patch
---

The two Chrome tests (`sealed.browser.test.ts`, `csp.browser.test.ts`) wait up to 120 seconds for Chrome to start and the page to load, not 30: on a busy CI runner running every core test file at once, starting Chrome alone took about 30 seconds. Test-only; nothing a store uses changes.
