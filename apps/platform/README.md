# platform

The platform console for Admin and Partner users: a static SPA on Cloudflare Pages at
`platform.dripfunnel.com`, calling the Platform API at `/api`. Design: docs/platform/CONSOLE-DESIGN.md.

```bash
pnpm --filter ./apps/platform dev   # http://localhost:5174, /api proxied to the local Worker
```
