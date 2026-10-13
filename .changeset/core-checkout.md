---
'@dripfunnel/storefront-core': minor
---

The checkout controller (#313 part 3). `./theme` gains `useCheckout` (contact → delivery address → delivery → payment → review, the engine deciding what each step needs; placing the order and taking its payment), `PlaceOrder`, the sealed `PaymentElement` (part `payment`), the headless `Form`, `SubmitButton`, `TextField`, `Choices` and `AddressFields`, and `addressDraft` and `orderPath`. The payment adapters load Stripe.js (`@stripe/stripe-js`), Razorpay, Cashfree and PayPal only when the shopper pays with them; express wallets only on a live shop. `installTrustedTypes` takes `paymentHosts`; `guestShopState` is the preview's client state; checkout requires the payment element and the summary where core gave it a price.
