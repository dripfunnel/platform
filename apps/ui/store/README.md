# store

The merchant and vendor portal: a static SPA on Cloudflare Pages, served on each partner's
portal host in the partner's look, calling the Store API at `/api`. Guide:
[docs/ui/store/](../../../docs/ui/store/README.md) (users, roles, navigation, design docs).

```bash
pnpm --filter ./apps/ui/store dev   # http://localhost:5173, /api proxied to the local Worker
```
