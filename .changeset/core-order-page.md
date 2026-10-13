---
'@dripfunnel/storefront-core': minor
---

`useOrder` (from `./theme`) reads the order `/order/{id}/` names, asking the provider about a card payment still pending, with a bank transfer's details while it is awaited, and `payAgain` for a card payment that hasn't gone through (`useRepay`, the checkout's payment flow for a placed order). `OrderSummary` also takes a placed `order`, listing its lines and what was charged.
