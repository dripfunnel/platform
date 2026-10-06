# store

The merchant and vendor portal: a static SPA on Cloudflare Pages, served on each partner's
portal host in the partner's look, calling the Store API at `/api`. Guide:
[docs/ui/store/](../../../docs/ui/store/README.md) (users, roles, navigation, design docs).

```bash
pnpm dev:https   # every partner's portal at https://store.<partner>.localhost (docs/setup/local.md §7.3)
pnpm --filter ./apps/ui/store dev   # http://localhost:5173: the sample harness below; /api reaches no partner here
```

A staff impersonation (ACCESS.md §8.1) arrives at `/impersonate/enter?token=…` and shows the
bar from `@dripfunnel/shared/ui` above every page. Without the admin console, `?state=` shows
`impersonating`, `notice` (what everyone else signed in sees), `ended`, `expired` and
`invalid`.
The bar's Back link goes to the admin console on its dev port under `vite dev`; a build
uses `VITE_ADMIN_URL` (https only, e.g. a feature environment's console) or
`https://admin.dripfunnel.com`.

**Without an API** (`vite dev`, or a build with `VITE_STATE_HARNESS=1`; ui/README.md §6), the shell
renders from a sample:

- `?as=` a seat: `owner`, `manager`, `staff`, `supplier-stock`, `supplier-catalogue`,
  `supplier-orders`, `supplier-admin`;
- `?store=` a standing: `trial` (the default), `trial-ending`, `active`, `pastdue`, `suspended`,
  `cancelled`, `provisioning`, `support`;
- `?brand=partner`: the prototype's partner look (Northstar);
- `?state=` a screen state, as on every screen; `/stores?as=owner` shows the chooser.
