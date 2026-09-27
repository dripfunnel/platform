# platform

The DripFunnel platform: a headless, multi-tenant commerce engine with white-label brands,
vendors, an AI-designed storefront per store, the merchant portal and the platform console, in one repo
and deployed on Cloudflare.

**Status: skeleton**, no features yet. Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Folder | What |
|---|---|
| `apps/api` | The one Worker: engine, Store, Platform and Shop APIs, webhooks, jobs |
| `apps/store` | Merchant and vendor portal (Pages SPA) |
| `apps/platform` | Admin and Partner console (Pages SPA) |
| `shared/` | Code both SPAs use |
| `packages/storefront-core` | The one published package, installed by store repos |
| `templates/storefront/` | The template copied into each store's own repo |
| `docs/` | The specification |

Working rules for people and agents: [AGENTS.md](AGENTS.md).
