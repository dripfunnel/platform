# templates/storefront

The source of the storefront template. When a merchant first picks a template, the platform
copies this folder into a new store repo through the GitHub App and writes the store's
`site.json`; the AI designer changes only that site data, never this code.

Specification: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) and
[docs/storefront/DESIGN.md](../../docs/storefront/DESIGN.md).

**Status: skeleton.** A static export (`next build`) of one baseline page. `src/app/` is the
locked shim layer; `src/theme/` holds the baseline pages every store shares, styled by its
site data.
