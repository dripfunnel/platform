# templates/storefront

The source of the storefront template. When a merchant first picks a template, the platform
copies this folder, with the chosen starting theme, into a new store repo through the GitHub
App. From then on the AI designer writes that store's theme (`src/theme/**`, `content/**`,
`routes.json`) inside the walls of the storefront ARCHITECTURE §3; everything else here is
locked.

Specification: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) and
[docs/storefront/DESIGN.md](../../docs/storefront/DESIGN.md).

**Status: skeleton.** A static export (`next build`) of one baseline page. `src/app/` is the
locked shim layer; `src/theme/` holds the baseline theme ("Start from scratch"); the six
starting themes will live in `themes/{key}/` (ST 0).
