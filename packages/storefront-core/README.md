# @dripfunnel/storefront-core

The locked commerce core every DripFunnel storefront runs on. Store repos install it from
GitHub Packages; the AI designer never edits it, and changes a store's look only through site data in this package's schema. Published with Changesets.

Design: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) §2–3.

| Entry | What |
|---|---|
| `@dripfunnel/storefront-core` | Shop API client, theme contract, the site-data schema, template presets and renderer (`site/`) |
| `@dripfunnel/storefront-core/tsconfig` | TypeScript preset for store repos |
| `@dripfunnel/storefront-core/eslint` | Lint preset for store repos (theme rules) |
