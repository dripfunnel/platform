---
'@dripfunnel/storefront-core': minor
---

`useSignIn` and `useAccount` (from `./theme`): sign-in by email and password or by an emailed or texted code (which also creates an account or sets a new password), keeping the session for the visit or longer; the signed-in shopper's details and addresses, with sign-out. `useOrder` also reads an order in the account, `/account/orders/{id}/`. On a preview neither asks the Shop API anything.
