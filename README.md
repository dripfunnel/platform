# platform

The DripFunnel platform: a headless, multi-tenant commerce engine with white-label brands,
vendors, an AI-designed storefront per store, the merchant portal, the partner console and
the admin console, in one repo and deployed on Cloudflare. A merchant mobile app for iOS and
Android is planned.

**Status: skeleton**, no features yet. Start with [docs/README.md](docs/README.md), the
map of the specification: every portal, its users and roles, and what to read for a task.

| Folder | What |
|---|---|
| `apps/api` | The one Worker: engine, Admin, Platform, Store and Shop APIs, webhooks, jobs |
| `apps/ui/store` | Merchant and vendor portal (Pages SPA) |
| `apps/ui/platform` | Partner console (Pages SPA), `platform.dripfunnel.com` |
| `apps/ui/admin` | DripFunnel staff console (Pages SPA), `admin.dripfunnel.com` |
| `apps/ui/mobile-app/merchant` | *Planned, not built yet.* The merchant portal as an iOS and Android app (React Native with Expo), one build per partner in the partner's look, built and submitted by hand: [docs/mobile-app/merchant/](docs/mobile-app/merchant/REACT-NATIVE.md) |
| `apps/ui/shared/` | Code more than one SPA uses |
| `packages/storefront-core` | The one published package, installed by store repos |
| `templates/storefront/` | The template copied into each store's own repo |
| `docs/` | The specification, laid out like the code |

Working rules for people and agents: [AGENTS.md](AGENTS.md).

**Setting up an environment**, step by step: [local](docs/setup/local.md) (your own machine),
[dev](docs/setup/dev.md) (`dripfunnel.ai`, deployed from `dev`) and
[prod](docs/setup/prod.md) (`dripfunnel.com`, deployed from `main`).

Claude Code connects to GitHub (issues, pull requests, the DripFunnel project) through
[`.mcp.json`](.mcp.json) with your own token: set it up once with
[docs/code/GITHUB-MCP.md](docs/code/GITHUB-MCP.md).
