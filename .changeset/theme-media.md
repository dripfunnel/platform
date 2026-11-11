---
'@dripfunnel/storefront-core': minor
---

A store repo's theme may hold its own images (#1405): PNG, JPEG and WebP in `src/theme/media/`, at most 2 MB each, 100 images and 20 MB in all, which don't count toward the code caps. The validator reads each image's type from its bytes and checks its structure, and refuses with its own rule a wrong name, an SVG or video, a type its name doesn't say, a damaged file, a side over 10,000 px and each cap.

`ThemeImage` (from `./theme`) draws one by its file name, `<ThemeImage src="haldi-home.webp" alt={t('…')} ratio={1.5} />`, and CSS names one as `url(media/haldi-home.webp)`; the validator refuses a name with no image (`jsx/theme-image-not-found`, `css/media-not-found`). Whatever boots the theme gives the addresses through `ThemeMediaProvider`. `pnpm check` reads images from disk. A live page's `img-src` now allows the asset host, where a stylesheet's images are.

The AI studio can't add, change or remove these images. Every addition is optional; no theme has to change.
