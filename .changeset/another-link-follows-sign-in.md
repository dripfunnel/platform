---
'@dripfunnel/storefront-core': minor
---

The link under the code box on Create an account, Sign in and Forgot password follows the store's sign-in setting (#1566): "Use another email" for email only, "Use another number" for a mobile number only, and "Use another email or number" for both. The starting themes' sign-in views pick the text from `useSignIn().ways`, and each ships `shop.account.anotherEmail`. Existing stores get it through the upgrade's codemods in 2.1.0 (a theme that changed the view, or that has other languages, follows the upgrade notes).
