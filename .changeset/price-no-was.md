---
'@dripfunnel/storefront-core': major
---

The sealed `<Price>` no longer puts the word "Was" before the crossed-out compare-at price (#1357): it shows the old price struck through on its own, with no text for screen readers either. This changes how every store's price looks, so it is a major.

Upgrade notes: no code change is needed. A theme that styles `::part(was)` keeps working; a theme or visual test that expects the text "Was {price}" next to the old price must drop it. The `price.was` message stays but is no longer used.
