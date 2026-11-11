import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build, context, type BuildContext, type BuildOptions, type Message, type Metafile, type OutputFile, type Plugin } from 'esbuild'
import { z } from 'zod'
import { readThemeStyling, themeStylesheet } from '@dripfunnel/storefront-core/guard'
import { imageMapSource, readImages, themeImagePlugin, writeImages, type ThemeImageFile } from './media'
import type { GateProblem } from './problems'

// The fast gate's bundle is the studio frame and the preview (storefront AI-STUDIO §1, PREVIEW §4): the theme's own
// chunks, with react, core and the allowed libraries taken from the core runtime the image carries (runtime/build.ts).
export const runtimeModules: Readonly<Record<string, string>> = {
  react: 'react.js',
  'react/jsx-runtime': 'jsx-runtime.js',
  '@dripfunnel/storefront-core/theme': 'theme.js',
  clsx: 'clsx.js',
  motion: 'motion.js',
  'motion/react': 'motion.js',
}
export const bootModule = 'boot.js'

/** The folder under the bundle's assets that core's runtime is served from; a preview never stores it (PREVIEW §3). */
export const runtimeFolder = 'assets/core/'

export type ClientBundle = { id: string; entry: string; files: { path: string; bytes: number }[] }

const entryName = 'df:entry'

// routes.json as the generated entry reads it; the validator checked it against core's themeRoutesSchema, and the page
// names are held to its pattern again because they become import paths (a loaded draft hasn't met the validator).
const page = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,4}$/)
export const routesSchema = z.object({ routes: z.record(z.string().regex(/^[A-Za-z]+$/), page), custom: z.record(z.string().regex(/^\/[a-z0-9/-]+$/), page).optional() })

/** Each language's words, flattened to the `file.key` names `t()` takes (ARCHITECTURE §3.4 "t()"). */
export type Content = Record<string, Record<string, string>>

/** The theme's stylesheet from guard's themeStylesheet: core's reduced-motion rule, then its Tailwind classes. */
export const stylesheetModule = 'df:tailwind'

// The client and the server builds both carry it, since the minified CSS Module names depend on all the CSS (#1245).
export const stylesheetPlugin = (stylesheet: () => string): Plugin => ({
  name: 'df-stylesheet',
  setup(b) {
    b.onResolve({ filter: /^df:tailwind$/ }, () => ({ path: 'tailwind.css', namespace: 'df-tailwind' }))
    b.onLoad({ filter: /.*/, namespace: 'df-tailwind' }, () => ({ contents: stylesheet(), loader: 'css', resolveDir: b.initialOptions.absWorkingDir ?? '.' }))
  },
})

const entrySource = (routesJson: string, content: Content, media: string): string => {
  const routes = routesSchema.parse(JSON.parse(routesJson))
  const pages = [...new Set([...Object.values(routes.routes), ...Object.values(routes.custom ?? {})])]
  const local = new Map(pages.map((page, i) => [page, `p${i}`]))
  const exportOf = (page: string) => page.split('/').at(-1) ?? page
  const ref = (page: string) => local.get(page) ?? 'undefined'
  return [
    // First, so a CSS Module's rule wins over a Tailwind class of the same weight, as Tailwind's layers make it anyway.
    `import '${stylesheetModule}'`,
    `import { boot } from 'df:boot'`,
    ...pages.map((page) => `import { ${exportOf(page)} as ${ref(page)} } from './src/theme/pages/${page}.tsx'`),
    `export const theme = { routes: { ${Object.entries(routes.routes).map(([route, page]) => `${JSON.stringify(route)}: ${ref(page)}`).join(', ')} },`,
    `  custom: { ${Object.entries(routes.custom ?? {}).map(([path, page]) => `${JSON.stringify(path)}: ${ref(page)}`).join(', ')} },`,
    `  content: ${JSON.stringify(content)},`,
    `  media: ${media} }`,
    // Booted once; later bundles in the studio frame are loaded by the hot reload, which reads `theme` (runtime/boot.tsx).
    `boot(theme)`,
  ].join('\n')
}

const mediaId = /^[A-Za-z0-9_-]{1,128}$/

/**
 * A theme's `url(<media id>)` becomes the shop's own `/shop-api/assets/{id}`; the validator has already held the id to the
 * store's media (AI-STUDIO §8). The studio frame and a preview serve the stylesheet from `…/assets/`, so `../shop-api/…`
 * lands under the frame's session prefix or at the host's root; the live site's stylesheet is on the asset origin, so
 * its build names the shop's `origin`. First in the plugin list, or the bare-name rule below refuses the id.
 */
export const mediaUrlPlugin = (origin: string | null = null): Plugin => ({
  name: 'df-media-url',
  setup(b) {
    b.onResolve({ filter: mediaId }, (args) => (args.kind === 'url-token' ? { path: `${origin ?? '..'}/shop-api/assets/${args.path}`, external: true } : undefined))
  },
})

/** What the generated entry and the theme's stylesheet hold for the next build; a warm context reads them at each one. */
type Generated = { entry: string; stylesheet: string; images: ThemeImageFile[] }

const runtimePlugin = (generated: Generated): Plugin => ({
  name: 'df-runtime',
  setup(b) {
    b.onResolve({ filter: /^df:entry$/ }, () => ({ path: entryName, namespace: 'df' }))
    b.onLoad({ filter: /.*/, namespace: 'df' }, () => ({ contents: generated.entry, loader: 'ts', resolveDir: b.initialOptions.absWorkingDir ?? '.' }))
    b.onResolve({ filter: /^df:boot$/ }, () => ({ path: `./core/${bootModule}`, external: true }))
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      const file = runtimeModules[args.path]
      return file ? { path: `./core/${file}`, external: true } : { errors: [{ text: `${args.path} isn't a module a theme may import.` }] }
    })
  },
})

const flatten = (value: unknown, prefix: string, into: Record<string, string>) => {
  if (typeof value === 'string') into[prefix] = value
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, `${prefix}.${k}`, into)
}

export const readContent = async (repo: string): Promise<Content> => {
  const content: Content = {}
  const languages = await readdir(join(repo, 'content')).catch(() => [])
  for (const language of languages) {
    const words: Record<string, string> = {}
    for (const file of await readdir(join(repo, 'content', language))) {
      if (file.endsWith('.json')) flatten(JSON.parse(await readFile(join(repo, 'content', language, file), 'utf8')), file.slice(0, -'.json'.length), words)
    }
    content[language] = words
  }
  return content
}

const problemOf = (m: Message): GateProblem => ({ step: 'bundle', file: m.location?.file.replace(/^\.\//, '') ?? null, line: m.location?.line ?? null, rule: 'bundle/error', message: m.text })

const html = (entry: string, css: readonly string[]) =>
  [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">',
    ...css.map((c) => `<link rel="stylesheet" href="/${c}">`),
    `<script type="module" src="/${entry}"></script>`,
    '</head><body><div id="root"></div></body></html>',
    '',
  ].join('\n')

type Bundled = { ok: true; bundle: ClientBundle } | { ok: false; problems: GateProblem[] }
type Built = { errors: Message[]; metafile?: Metafile | undefined; outputFiles?: OutputFile[] | undefined }

const optionsFor = (repo: string, out: string, mediaOrigin: string | null, generated: Generated) =>
  ({
    absWorkingDir: repo,
    entryPoints: [entryName],
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    outdir: join(out, 'assets'),
    entryNames: 'entry-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: 'asset-[hash]',
    metafile: true,
    // Written here, not by esbuild: `out` starts empty each time, and a warm rebuild may skip a file it already wrote.
    write: false,
    logLevel: 'silent',
    plugins: [themeImagePlugin(() => generated.images), mediaUrlPlugin(mediaOrigin), stylesheetPlugin(() => generated.stylesheet), runtimePlugin(generated)],
  }) satisfies BuildOptions

/**
 * The working copy at `repo` into `out` (replaced whole) by `run`: a one-off build, or a warm context's rebuild.
 * `imageBase` is where a live build's assets/ is served from, so its pages name the theme's images as the bundle does.
 */
const bundleWith = async (repo: string, out: string, generated: Generated, run: () => Promise<Built>, imageBase: string | null = null): Promise<Bundled> => {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const tailwind = await themeStylesheet(readThemeStyling(repo))
  if (!tailwind.ok) return { ok: false, problems: tailwind.problems.map((p) => ({ step: 'bundle', ...p })) }
  generated.images = await readImages(repo)
  try {
    generated.entry = entrySource(await readFile(join(repo, 'routes.json'), 'utf8'), await readContent(repo), imageMapSource(generated.images, imageBase))
  } catch {
    return { ok: false, problems: [{ step: 'bundle', file: 'routes.json', line: null, rule: 'bundle/routes', message: "routes.json or content/** can't be read." }] }
  }
  generated.stylesheet = tailwind.css
  const result = await run().catch((error: { errors?: Message[] }): Built => ({ errors: error.errors ?? [{ text: String(error) } as Message] }))
  if (result.errors.length > 0 || !result.metafile) return { ok: false, problems: result.errors.map(problemOf) }
  for (const file of result.outputFiles ?? []) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.contents)
  }

  const outputs = Object.entries(result.metafile.outputs).map(([path, o]) => ({ path: path.slice(path.indexOf('assets/')), bytes: o.bytes, entry: o.entryPoint !== undefined }))
  const entry = outputs.find((o) => o.entry && o.path.endsWith('.js'))
  if (!entry) return { ok: false, problems: [{ step: 'bundle', file: null, line: null, rule: 'bundle/error', message: 'The bundle has no entry.' }] }
  const page = html(entry.path, outputs.filter((o) => o.path.endsWith('.css')).map((o) => o.path))
  await writeFile(join(out, 'index.html'), page)
  await writeImages(generated.images, join(out, 'assets'))
  const files = [{ path: 'index.html', bytes: Buffer.byteLength(page) }, ...outputs.map(({ path, bytes }) => ({ path, bytes })), ...generated.images.map((i) => ({ path: `assets/${i.file}`, bytes: i.bytes.byteLength }))]
  const id = createHash('sha256').update(files.map((f) => f.path).sort().join('\n')).digest('hex').slice(0, 16)
  return { ok: true, bundle: { id, entry: entry.path, files } }
}

/** Bundles the working copy at `repo` into `out` (replaced whole); the paths in the result are relative to `out`. */
export const bundle = (repo: string, out: string, mediaOrigin: string | null = null, imageBase: string | null = null): Promise<Bundled> => {
  const generated: Generated = { entry: '', stylesheet: '', images: [] }
  return bundleWith(repo, out, generated, () => build(optionsFor(repo, out, mediaOrigin, generated)), imageBase)
}

/** One slot's bundle with its esbuild context kept between changes (#1240), so a rebuild reparses only what changed. */
export class WarmBundle {
  private readonly generated: Generated = { entry: '', stylesheet: '', images: [] }
  private context: BuildContext<ReturnType<typeof optionsFor>> | null = null
  /** How many esbuild contexts this bundle has made: one for as long as the slot keeps its draft. */
  contexts = 0

  constructor(
    private readonly repo: string,
    private readonly out: string,
  ) {}

  run(): Promise<Bundled> {
    return bundleWith(this.repo, this.out, this.generated, async () => {
      if (!this.context) {
        this.context = await context(optionsFor(this.repo, this.out, null, this.generated))
        this.contexts += 1
      }
      return this.context.rebuild()
    })
  }

  async dispose(): Promise<void> {
    const open = this.context
    this.context = null
    await open?.dispose()
  }
}
