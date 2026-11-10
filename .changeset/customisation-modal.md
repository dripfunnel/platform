---
'@dripfunnel/storefront-core': minor
---

Products can ask the shopper questions before buying (#1372). `AddToCart` and `BuyNow` open a sealed customisation modal, a `<dialog>` in the top layer, for a product with questions: every question type, its rules and conditions, uploads with progress, and a live total from the Shop API. A product without questions adds as before, and the modal's code loads only when needed. Cart lines carry their answers, and the new `<LineAnswers>` and `<EditAnswers>` show them and reopen the modal filled in. The order summary at review lists them. See the 0.13.0 upgrade note.
