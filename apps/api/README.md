# api

The one Cloudflare Worker: the Store, Platform and Shop APIs, webhooks and background jobs,
and all server code. Layout and layer rules: [docs/code/ARCHITECTURE.md](../../docs/code/ARCHITECTURE.md) §2–3.

```bash
pnpm --filter ./apps/api dev      # wrangler dev
pnpm --filter ./apps/api schema   # regenerate schema/*.graphql after a schema change
```
