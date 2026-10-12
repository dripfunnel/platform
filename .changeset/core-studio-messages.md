---
'@dripfunnel/storefront-core': minor
---

The studio frame answers the studio's messages (storefront AI-STUDIO §8): `connectStudioFrame` posts `df-studio:page` with the page's path on every navigation, the first included, and, while the portal's `df-studio:edit` is on, outlines hovered words (a dark dashed ring on a white halo, `studioHoverColors`) and turns a click on them into `df-studio:text` with their content key instead of following it. Messages go only to the portal's origin and are heard only from the portal's window at that origin, which `studioFramePage` writes into the frame's page beside its CSP and `studioPortalOrigin` reads back. `createI18n` takes a `createTextKeys()` map that remembers each theme string it renders with its key (`home:hero.title`; the first key on identical words). Nothing changes in live or preview mode.
