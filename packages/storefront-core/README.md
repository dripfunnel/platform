# @dripfunnel/storefront-core

The locked commerce core every DripFunnel storefront runs on. Store repos install it from
GitHub Packages; the AI designer writes a store's theme against it and never edits it. Published with Changesets.

Design: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) §2–3.

| Entry | What |
|---|---|
| `@dripfunnel/storefront-core` | Shop API client (headers, zod-decoded operations), store settings and context, i18n, the branded `Money`, `Stock`, `Rating` and `Badge` with their decoders, the sealed components (price, consent, Cookie settings, preview, legal, "Powered by", breadcrumbs) and their problem reports, `<Link>`, the CSP and Trusted Types for a store and the studio frame, the section and checkout error boundaries, SEO, analytics, the route contract, the font allowlist and the contrast check |
| `@dripfunnel/storefront-core/theme` | What a theme may import: `useStorefront`, `<Link>`, the sealed components and the commerce types (storefront ARCHITECTURE §3.4) |
| `@dripfunnel/storefront-core/guard` | The validator the sandbox and the build run on every change and publish: `validateChange(files, context)` (storefront ARCHITECTURE §3.4) |
| `@dripfunnel/storefront-core/testing` | The contract checks a store repo's CI runs: unmapped routes, sealed components missing from a page or not seen on it |
| `@dripfunnel/storefront-core/tsconfig` | TypeScript preset for store repos |
| `@dripfunnel/storefront-core/eslint` | Lint preset for store repos (theme rules) |
