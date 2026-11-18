---
'@dripfunnel/storefront-core': minor
---

`storeCsp` takes a fourth argument, `fonts`, and names Google's font hosts (fonts.googleapis.com and fonts.gstatic.com) only when it is true, so a store whose theme lists no Google font keeps them out of its CSP. The guard exports `fontsIn`, which reads the families listed in `theme.css`. The default is false; a caller building a CSP for a theme that lists fonts passes `fontsIn(themeCss).length > 0`.
