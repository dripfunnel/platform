# admin

The admin console for DripFunnel staff (DF Admin): a static SPA on Cloudflare Pages at
`admin.dripfunnel.com`, calling the Admin API at `/api`. It manages every partner and platform.
Guide: [docs/ui/admin/](../../../docs/ui/admin/README.md); design: [CONSOLE-DESIGN.md](../../../docs/ui/admin/CONSOLE-DESIGN.md).

```bash
pnpm --filter ./apps/ui/admin dev   # http://localhost:5175, /api proxied to the local Worker
```
