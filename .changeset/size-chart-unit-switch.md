---
'@dripfunnel/storefront-core': minor
---

The Size chart window has a cm | in switch (#1571). It opens in the unit the merchant saved the chart in, and the shopper can switch to the other, both ways. Lengths and ranges convert cm ↔ in (× or ÷ 2.54, rounded to one decimal); a weight column (a name that says weight, kg or lb) converts kg ↔ lb (× or ÷ 2.2046) and its name follows ("Baby weight (kg)" ↔ "Baby weight (lb)"). Sizes, size systems and words stay as typed, the line under the table follows the switch, and switching back gives the merchant's own numbers. The window shows no switch for a chart whose unit isn't `cm` or `in`.

New messages `sizeChart.switch`, `sizeChart.switch.cm` and `sizeChart.switch.in`. This is a minor (docs/code/ARCHITECTURE.md §5): new behaviour inside a core component, backward-compatible, no theme has to change.
