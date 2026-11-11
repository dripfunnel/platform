import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isThemePath, mediaFolder, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import type { Plugin } from 'esbuild'

// The theme's own images (#1405): read as bytes, copied into the bundle's assets/ under a name from their content, and
// named to the theme by file name. A loaded draft hasn't met the validator, so names are held to its paths again.

export type ThemeImageFile = { name: string; file: string; bytes: Buffer }

/** The images in `repo`'s src/theme/media/, each with the file name it is served under. */
export const readImages = async (repo: string): Promise<ThemeImageFile[]> => {
  const names = (await readdir(join(repo, mediaFolder)).catch(() => [])).filter((n) => isThemePath(`${mediaFolder}${n}`)).sort()
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(join(repo, mediaFolder, name))
      // .jpeg is served as .jpg, the one extension the asset host's types know (api saas/storefronts/verify.ts).
      const extension = name.slice(name.lastIndexOf('.')).replace('.jpeg', '.jpg')
      return { name, file: `media-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${extension}`, bytes }
    }),
  )
}

/** Every file in `repo`'s src/theme/media/ as the validator takes it: base64, whatever its name, so it judges each. */
export const imageThemeFiles = async (repo: string): Promise<ThemeFile[]> => {
  const names = (await readdir(join(repo, mediaFolder), { recursive: true, withFileTypes: true }).catch(() => [])).filter((e) => e.isFile())
  return Promise.all(
    names.map(async (e) => {
      const path = join(e.parentPath, e.name).slice(join(repo).length + 1).replaceAll('\\', '/')
      return { path, content: (await readFile(join(repo, path))).toString('base64'), encoding: 'base64' as const }
    }),
  )
}

export const writeImages = async (images: readonly ThemeImageFile[], assets: string): Promise<void> => {
  await mkdir(assets, { recursive: true })
  for (const image of images) await writeFile(join(assets, image.file), image.bytes)
}

/**
 * CSS `url(media/<name>)` becomes the copy beside the stylesheet in assets/; a name with no image stops the bundle.
 * `images` is read at each build, as a warm context's rebuild asks again (gate/bundle.ts `WarmBundle`).
 */
export const themeImagePlugin = (images: () => readonly ThemeImageFile[]): Plugin => ({
  name: 'df-theme-image',
  setup(b) {
    b.onResolve({ filter: /^media\// }, (args) => {
      if (args.kind !== 'url-token') return undefined
      const found = images().find((i) => i.name === args.path.slice('media/'.length))
      return found ? { path: `./${found.file}`, external: true } : { errors: [{ text: `${args.path} names no image in ${mediaFolder}.` }] }
    })
  },
})

/**
 * The `{ name: address }` the entry hands ThemeMediaProvider, as JavaScript. With no `base` each address is worked out
 * beside the entry (the studio frame and a preview); a live build names `base`, so its pages and their hydration agree.
 */
export const imageMapSource = (images: readonly ThemeImageFile[], base: string | null): string =>
  `{ ${images.map((i) => `${JSON.stringify(i.name)}: ${base === null ? `new URL(${JSON.stringify(`./${i.file}`)}, import.meta.url).href` : JSON.stringify(`${base}${i.file}`)}`).join(', ')} }`
