---
'@dripfunnel/storefront-core': minor
---

The studio frame's hot reload swaps the bundle's stylesheets too (#1240). A bundle notice may name its stylesheets (`css`), which `connectHotReload` loads before the new theme modules render, so classes a change adds are styled at once; a notice with `only: 'stylesheet'` changed no script, and only the stylesheets are swapped, keeping the page, its state and the scroll. `HotReloadOptions.stylesheets` replaces how they are swapped (by default each new `<link>` loads before the old ones leave). A notice without `css` reloads the modules as before.

Upgrade notes: no theme changes and no codemod runs; the hot reload is core's own runtime in the studio frame.
