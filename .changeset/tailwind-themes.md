---
'@dripfunnel/storefront-core': minor
---

Themes may be styled with Tailwind v4 (#1239). Core pins `tailwindcss` 4.3.3 and adds `validateTheme`, the validator with the class rules: every class a theme's code writes is checked, arbitrary values may hold no `url(`, `@import`, address or escape, and what Tailwind writes for a class is held to the CSS rules (its own element only, z-index, transitions, no words). A theme's tokens go in `src/theme/styles/theme.css` as `@theme` values, a new theme path; `themeStylesheet` builds a theme's classes for the bundle (`readThemeStyling` reads them from a repo), `themeCssPath` names the file, and `@dripfunnel/storefront-core/postcss` is the PostCSS plugin a store repo's locked Next.js build uses to build the same classes. `--tw-content` holding words is refused in a CSS Module too. `validateChange` is unchanged.

Upgrade notes: no theme has to change and no codemod runs. A theme of CSS Modules writes no class, so it validates and bundles exactly as before; to restyle a part with classes, write Tailwind classes in `className` or `clsx`, and its tokens in `src/theme/styles/theme.css`. `@apply` stays refused. The security fallback (`baselineWithOwn`) carries a store's `--ink` or `--heading-font` into a Tailwind baseline's `--color-ink` or `--font-heading`.
