---
'@dripfunnel/storefront-core': patch
---

The publish gate's visual diff compares an upgrade with the live site as shoppers see it: the live page gets the same shop data as the new build (#1087), and its own scripts run from the asset host (#1092). An upgrade is refused only for a real change of look. Themes change nothing.
