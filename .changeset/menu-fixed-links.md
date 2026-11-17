---
'@dripfunnel/storefront-core': major
---

A live page's header menu no longer changes after the page has loaded (#1481). `useMenu()` keeps the menu the page was built with and does not ask the Shop API for another (`useShopData` gains the `keepBuilt` option behind it), so a header shows the same menu from its first paint and on every reload; a menu change reaches the live site with the next publish. The preview and the studio still load the current menu.

The Classic and Baseline themes now always draw their fixed links around the merchant's menu items. Classic's header is Home, Shop all, the items (or every collection while there are none), About and Contact; before, the merchant's first menu item replaced Shop all, About and Contact. Baseline always draws Shop, then the items, About and Contact. The phone menu draws the same links.

This is a major (docs/code/ARCHITECTURE.md §5): a hook's documented behaviour changes and the header of every Classic and Baseline store changes. Upgrade notes (`coreUpgradeNotes`, numbered 0.14.1 until its release card renumbers it): codemods rewrite the header of a Classic or Baseline theme that still has the shipped markup, at the merchant's next publish; a theme that draws its own header places the fixed links around `menu.items` itself and draws nothing that depends on the menu changing after load. Market draws no merchant menu and does not change.
