# store

The merchant and vendor portal: a static SPA on Cloudflare Pages, served on each partner's
portal host in the partner's look, calling the Store API at `/api`.

```bash
pnpm --filter ./apps/store dev   # http://localhost:5173, /api proxied to the local Worker
```
