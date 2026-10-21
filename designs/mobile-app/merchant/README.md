# designs/mobile-app/merchant: the merchant mobile app prototype

**Open `DF Store App.dc.html`.** It is the source for the app's **shell only**: header, bottom
tab bar per role, More, the app's Home and Storefront, bottom sheets, toasts and banners.

**Every other screen in this folder is an older copy** of a Store prototype screen. They are
kept only because `DF Store App` loads its screens from this folder by name, so without them it
won't run. **Don't build from them.** Each screen's content comes from
`designs/DF Store Prototype.dc.html` at phone width (`device=phone`). The six screens missing
here (My profile, Support access, Developer settings, Activity, Storefront content, Supplier
views) come from there too.

Rules: [docs/mobile-app/merchant/DESIGN.md](../../../docs/mobile-app/merchant/DESIGN.md) §1. Map:
[designs/design.md](../../design.md) §1.
