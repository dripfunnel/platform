# store

The merchant and vendor portal: a static SPA on Cloudflare Pages, served on each partner's
portal host in the partner's look, calling the Store API at `/api`. Guide:
[docs/ui/store/](../../../docs/ui/store/README.md) (users, roles, navigation, design docs).

```bash
pnpm --filter ./apps/ui/store dev   # http://localhost:5173, /api proxied to the local Worker
```

A staff impersonation (ACCESS.md §8.1) arrives at `/impersonate/enter?token=…` and shows the
bar from `@dripfunnel/shared/ui` above every page. Without the admin console, `?state=` shows
`impersonating`, `notice` (what everyone else signed in sees), `ended`, `expired` and
`invalid`.
The bar's Back link goes to the admin console on its dev port under `vite dev`; a build
uses `VITE_ADMIN_URL` (https only, e.g. a feature environment's console) or
`https://admin.dripfunnel.com`.
