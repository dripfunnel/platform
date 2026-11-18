---
'@dripfunnel/storefront-core': minor
---

The sign-in, create-account and reset-password pages can draw their form once (#1490). `useSignIn()` now returns `waysKnown`: false from the first draw of a live page until the Shop API has answered which ways the store signs shoppers in by, true after, at once on a preview (which never asks), and when the store can't be asked (`ways` is then email only, so no page waits for ever). A theme draws only its heading while it is false, so the tabs and fields appear once, from the store's setting, instead of an email form first and the Mobile number tab or form popping in afterwards.

`ways` is unchanged (email only until the answer, both on a preview), so a theme that doesn't read `waysKnown` draws as it always did. This is a minor (docs/code/ARCHITECTURE.md §5): new behaviour, backward-compatible, no theme has to change.

The Classic, Baseline, Beauty, Electronics, Fashion, Grocery, Home and Jewelry themes read it. Upgrade notes (`coreUpgradeNotes`, numbered 1.0.1 until its release card renumbers it): codemods add the check to the shipped sign-in view of a store made from any of them; a theme that changed that view places `if (!s.waysKnown) return <section><h1>{title}</h1></section>` after its preview check itself. Market has no sign-in view.
