# platform

The platform console for Partner users: a static SPA on Cloudflare Pages at
`platform.dripfunnel.com`, calling the Platform API at `/api`. DripFunnel staff use
`apps/ui/admin` instead. Guide: [docs/ui/platform/](../../../docs/ui/platform/README.md).

```bash
pnpm --filter ./apps/ui/platform dev   # http://localhost:5174, /api proxied to the local Worker
```

A staff impersonation or setup session (ACCESS.md §8.1, §8.2) arrives at
`/impersonate/enter?token=…` and shows the bar from `@dripfunnel/shared/ui` above every page.
Without the admin console, `?state=` shows `impersonating`, `setup`, `notice`, `noticeSetup`,
`ended`, `expired` and `invalid`.
The bar's Back link goes to the admin console on its dev port under `vite dev`; a build
uses `VITE_ADMIN_URL` (https only, e.g. a feature environment's console) or
`https://admin.dripfunnel.com`.
