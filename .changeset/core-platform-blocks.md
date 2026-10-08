---
"@dripfunnel/storefront-core": minor
---

The platform blocks (#304 part 2): `createShopClient` sends the store key, language, currency, market, cart and session headers and decodes answers with zod (`query`); `loadStore` and `StorefrontProvider`; `createI18n` with core's English messages; `formatMoney` for minor units; the required components `Price`, `ConsentBanner`, `PreviewBanner`, `LegalNotices` and `PoweredBy`; `seoFor`; `createAnalytics` with GA4, Google Tag Manager and Meta Pixel, each only after consent; the route list and `defineTheme` routes; the font allowlist (`fonts`, `fontStack`) and the WCAG contrast check (`contrastRatio`, `readableOn`); and `@dripfunnel/storefront-core/testing`.
