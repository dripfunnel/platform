# @dripfunnel/storefront-core

The locked commerce core every DripFunnel storefront runs on. Store repos install it from
GitHub Packages; the AI designer never edits it, and changes a store's look only through site data in this package's schema. Published with Changesets.

Design: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) §2–3.

| Entry | What |
|---|---|
| `@dripfunnel/storefront-core` | Shop API client (headers, zod-decoded operations), store settings and context, i18n, money, the required components (price, consent, preview, legal, "Powered by"), SEO, analytics, the route contract, and the site-data schema, presets and renderer (`site/`) |
| `@dripfunnel/storefront-core/testing` | The contract checks a store repo's CI runs: unmapped routes, missing required components |
| `@dripfunnel/storefront-core/tsconfig` | TypeScript preset for store repos |
| `@dripfunnel/storefront-core/eslint` | Lint preset for store repos (theme rules) |
