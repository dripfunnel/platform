# AGENTS.md: this store's site

**A push to `main` goes live by itself.** The platform builds the pushed commit, checks it, and puts it
on the store's live address. A change that breaks the theme rules is refused, and the site stays as it was.

**Before every push to `main`, run:**

```bash
pnpm check
```

It runs the build's theme rules on the files git holds, then the TypeScript check, and prints each problem
as `file:line  rule  message`. Fix every problem it prints, and `git add` any file it says is not added or
changed since `git add`, before you commit and push. A few rules need the store's own data, so only the build checks them; `pnpm check` names
them at the end.

## Adding an image to the theme

1. Put the file in `src/theme/media/`, directly in the folder: PNG, JPEG or WebP, at most 2 MB, 1 to 10,000 pixels a side.
   Name it with plain letters, digits, `-` and `_`, and a lower-case `.png`, `.jpg`, `.jpeg` or `.webp`, such as
   `haldi-home.webp`. The theme holds at most 100 images and 20 MB of them. No SVG or video.
2. Show it in a page or component with core's `ThemeImage`, its words from the content like any other text:

   ```tsx
   import { ThemeImage, useStorefront } from '@dripfunnel/storefront-core/theme'

   const { t } = useStorefront()
   <ThemeImage src="haldi-home.webp" alt={t('pages.home.bannerAlt')} ratio={1.5} />
   ```

   Or as a background in a CSS Module: `background-image: url(media/haldi-home.webp);`.
3. `git add` the image with the code that uses it, run `pnpm check`, and push.

`src` is the file's name, written out; `pnpm check` refuses a name with no file in `src/theme/media/`, and a file whose
bytes aren't the image type its name says. `pnpm dev` shows both a `ThemeImage` and a CSS background image. A picture
the merchant uploaded in Storefront › Assets is shown with `MerchantImage` and its asset id instead.
