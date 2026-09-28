# platform

The platform console for Partner users: a static SPA on Cloudflare Pages at
`platform.dripfunnel.com`, calling the Platform API at `/api`. DripFunnel staff use
`apps/ui/admin` instead. Guide: [docs/ui/platform/](../../../docs/ui/platform/README.md).

```bash
pnpm --filter ./apps/ui/platform dev   # http://localhost:5174, /api proxied to the local Worker
```
