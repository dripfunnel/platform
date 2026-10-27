# templates/storefront

The source of the storefront template. When a merchant first picks a template, the platform
copies this folder, with the chosen starting theme, into a new store repo through the GitHub
App. From then on the AI designer writes that store's theme (`src/theme/**`, `content/**`,
`routes.json`) inside the walls of the storefront ARCHITECTURE §3; everything else here is
locked.

Specification: [docs/storefront/ARCHITECTURE.md](../../docs/storefront/ARCHITECTURE.md) and
[docs/storefront/DESIGN.md](../../docs/storefront/DESIGN.md).

**Status: skeleton.** A static export (`next build`) of one placeholder page: `src/app/` is the
locked shim layer and `src/theme/` its placeholder. The starting themes are in `themes/{key}/`
(#486): `baseline` ("Start from scratch", from `designs/DF Storefront Prototype`) and `linen`,
`concrete`, `bloom`, `circuit`, `market` and `atelier` (from `designs/storefront-lib.js`). Each holds
`src/theme/**`, `content/en/*.json`, `routes.json` and `template.json` (the gallery's name, tag,
description, demo store and the lowest core it runs on, mirrored by the `storefront_template`
rows), and passes the validator, the preview bundle and the publish gate in
`apps/sandbox/src/themes.test.ts`.

**Running a store repo locally.** A store repo comes with `.npmrc` (core's registry) and a generated
`.env.development` naming the store's own shop, which `next dev` proxies `/shop-api` to
(`next.config.ts`). Once per machine, put a GitHub token with `read:packages` in your own `~/.npmrc`
(`//npm.pkg.github.com/:_authToken=…`), never the repo's; then `pnpm install` and `pnpm dev`.

`src/app/Shell.tsx` wraps pages in `StorefrontProvider` so `next dev` can render a theme. It is for local development only: `poweredBy` is `null` there. Shipped builds render through the sandbox, which sets it from the store's snapshot (`apps/sandbox/src/publish/render.ts`).
