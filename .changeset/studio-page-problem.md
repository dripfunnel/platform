---
'@dripfunnel/storefront-core': minor
---

The studio frame now tells the portal when a section of the theme throws (`df-studio:problem` with the section's name, never the error), so the studio can say the page couldn't show instead of leaving a blank preview. Each catch is posted, a repeat after a hot reload too. Nothing changes on a live or preview site, and no code change is needed in a theme.
