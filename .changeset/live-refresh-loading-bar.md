---
'@dripfunnel/storefront-core': minor
---

A live page shows a thin loading bar at the top while it checks the shop for newer content (#1578). A live page starts from the answers saved at the last Publish and asks the Shop API again, so a change made since (a product's A+ content, a price, a photo) used to appear a moment later with no sign it was coming. `PrefilledProvider` now draws the bar while any pre-filled answer is being asked again, marks the page `aria-busy`, names the bar "Checking for updates" (`refresh.checking`) and stops its animation under reduced motion. It goes away when the newer answers arrive or a check fails, and the page keeps what it shows. The header menu (#1481), the preview, the studio and a question the build had no answer for are unchanged. Core draws it, so every theme and every existing store gets it with the upgrade, with no theme change.
