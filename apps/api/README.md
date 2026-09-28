# api

The one Cloudflare Worker: the Store, Platform, Admin and Shop APIs, webhooks and background jobs,
and all server code. Guide: [docs/api/README.md](../../docs/api/README.md) (APIs, layout, layers, how to add code).

```bash
pnpm --filter ./apps/api dev      # wrangler dev
pnpm --filter ./apps/api schema   # regenerate schema/*.graphql after a schema change
```
