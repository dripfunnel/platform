import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build, type Message, type Plugin } from 'esbuild'
import { z } from 'zod'
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

const entrySource = (routesJson: string, content: Content): string => {
  const routes = routesSchema.parse(JSON.parse(routesJson))
  const pages = [...new Set([...Object.values(routes.routes), ...Object.values(routes.custom ?? {})])]
  const local = new Map(pages.map((page, i) => [page, `p${i}`]))
  const exportOf = (page: string) => page.split('/').at(-1) ?? page
  const ref = (page: string) => local.get(page) ?? 'undefined'
  return [
    `import { boot } from 'df:boot'`,
    ...pages.map((page) => `import { ${exportOf(page)} as ${ref(page)} } from './src/theme/pages/${page}.tsx'`),
    `export const theme = { routes: { ${Object.entries(routes.routes).map(([route, page]) => `${JSON.stringify(route)}: ${ref(page)}`).join(', ')} },`,
    `  custom: { ${Object.entries(routes.custom ?? {}).map(([path, page]) => `${JSON.stringify(path)}: ${ref(page)}`).join(', ')} },`,
    `  content: ${JSON.stringify(content)} }`,
    // Booted once; later bundles in the studio frame are loaded by the hot reload, which reads `theme` (runtime/boot.tsx).
    `boot(theme)`,
  ].join('\n')
}

const runtimePlugin = (entry: string): Plugin => ({
  name: 'df-runtime',
  setup(b) {
    b.onResolve({ filter: /^df:entry$/ }, () => ({ path: entryName, namespace: 'df' }))
    b.onLoad({ filter: /.*/, namespace: 'df' }, () => ({ contents: entry, loader: 'ts', resolveDir: b.initialOptions.absWorkingDir ?? '.' }))
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

/** Bundles the working copy at `repo` into `out` (replaced whole); the paths in the result are relative to `out`. */
export const bundle = async (repo: string, out: string): Promise<{ ok: true; bundle: ClientBundle } | { ok: false; problems: GateProblem[] }> => {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  let source: string
  try {
    source = entrySource(await readFile(join(repo, 'routes.json'), 'utf8'), await readContent(repo))
  } catch {
    return { ok: false, problems: [{ step: 'bundle', file: 'routes.json', line: null, rule: 'bundle/routes', message: "routes.json or content/** can't be read." }] }
  }
  const result = await build({
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
    write: true,
    logLevel: 'silent',
    plugins: [runtimePlugin(source)],
  }).catch((error: { errors?: Message[] }) => ({ errors: error.errors ?? [{ text: String(error) } as Message], metafile: undefined }))
  if (result.errors.length > 0 || !result.metafile) return { ok: false, problems: result.errors.map(problemOf) }

  const outputs = Object.entries(result.metafile.outputs).map(([path, o]) => ({ path: path.slice(path.indexOf('assets/')), bytes: o.bytes, entry: o.entryPoint !== undefined }))
  const entry = outputs.find((o) => o.entry && o.path.endsWith('.js'))
  if (!entry) return { ok: false, problems: [{ step: 'bundle', file: null, line: null, rule: 'bundle/error', message: 'The bundle has no entry.' }] }
  const page = html(entry.path, outputs.filter((o) => o.path.endsWith('.css')).map((o) => o.path))
  await writeFile(join(out, 'index.html'), page)
  const files = [{ path: 'index.html', bytes: Buffer.byteLength(page) }, ...outputs.map(({ path, bytes }) => ({ path, bytes }))]
  const id = createHash('sha256').update(files.map((f) => f.path).sort().join('\n')).digest('hex').slice(0, 16)
  return { ok: true, bundle: { id, entry: entry.path, files } }
}
