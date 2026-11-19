---
'@dripfunnel/storefront-core': minor
---

The "Before you add" window no longer adds its own "None" to an optional pick-one question (#1572). Only the merchant's choices show, with none picked at first, so a question with its own "No, thanks" no longer offers two ways of saying no. Once a choice is picked, a "Clear" button (named "Clear: " and the question) goes back to no answer; required and multi-pick questions are unchanged. The message `customise.none` is replaced by `customise.clear` and `customise.clearNamed`; a store that worded `customise.none` in its own catalogue can drop it. No change to the package's API.
