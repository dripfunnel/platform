# templates/storefront

The source of the storefront template. Provisioning copies this folder into each new store
repo through the GitHub API; the AI designer then works only in that repo's `src/theme/**`.

Specification: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) and
[docs/storefront/DESIGN.md](../../docs/storefront/DESIGN.md).

**Status: skeleton.** A static export (`next build`) of one baseline page. `src/app/` is the
locked shim layer; `src/theme/` is the only folder the AI may change.
