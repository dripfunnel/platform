import { mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ComponentType } from 'react'
import { build, type Plugin } from 'esbuild'
import type { CoreRoute, ShopStoreSettings } from '@dripfunnel/storefront-core'
import { readContent, routesSchema, runtimeModules } from '../gate/bundle'

// The static build's renderer (storefront ARCHITECTURE §4.2 "Live"): the theme's pages bundled for Node with the same
// core and libraries the client bundle loads, then rendered to HTML once per page from the frozen snapshot.

export type PageValue = { store: ShopStoreSettings; poweredBy: string | null; path: string }

export interface ServerTheme {
  page: (route: CoreRoute | null, custom: string | null) => ComponentType | undefined
  render: (page: ComponentType, value: PageValue) => string
}

const ownPackages = fileURLToPath(new URL('.', import.meta.url))
const entryName = 'df:server-entry'

// Bare imports resolve only to what a theme may import, from the image's own packages, never from the store's repo.
const resolveOwn = (): Plugin => ({
  name: 'df-server',
  setup(b) {
    const fromHere = createRequire(join(ownPackages, 'render.js'))
    b.onResolve({ filter: /^df:server-entry$/ }, () => ({ path: entryName, namespace: 'df' }))
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      const allowed = args.namespace === 'df' || Object.hasOwn(runtimeModules, args.path) || !args.importer.includes('/src/theme/')
      if (!allowed) return { errors: [{ text: `${args.path} isn't a module a theme may import.` }] }
      if (isBuiltin(args.path)) return { path: args.path, external: true }
      try {
        return { path: fromHere.resolve(args.path) }
      } catch {
        return { errors: [{ text: `${args.path} can't be found in the build image.` }] }
      }
    })
  },
})

const entrySource = (routesJson: string, content: unknown): string => {
  const routes = routesSchema.parse(JSON.parse(routesJson))
  const pages = [...new Set([...Object.values(routes.routes), ...Object.values(routes.custom ?? {})])]
  const ref = (page: string) => `p${pages.indexOf(page)}`
  return [
    `import { renderToString } from 'react-dom/server'`,
    `import { jsx } from 'react/jsx-runtime'`,
    `import { createI18n, createShopClient, StorefrontProvider } from '@dripfunnel/storefront-core'`,
    ...pages.map((page) => `import { ${page.split('/').at(-1) ?? page} as ${ref(page)} } from './src/theme/pages/${page}.tsx'`),
    `const routes = { ${Object.entries(routes.routes).map(([route, page]) => `${JSON.stringify(route)}: ${ref(page)}`).join(', ')} }`,
    `const custom = { ${Object.entries(routes.custom ?? {}).map(([path, page]) => `${JSON.stringify(path)}: ${ref(page)}`).join(', ')} }`,
    `const content = ${JSON.stringify(content)}`,
    `export const page = (route, path) => (path ? custom[path] : routes[route])`,
    // The same provider value the page's script hydrates with (runtime/boot.tsx); no request is made while rendering.
    `export const render = (Page, { store, poweredBy, path }) => renderToString(jsx(StorefrontProvider, { value: { client: createShopClient({}), store, locale: store.language, t: createI18n(store.language, content).t, mode: 'live', poweredBy }, address: path, children: jsx(Page, {}) }))`,
  ].join('\n')
}

/** Bundles the checked-out theme at `repo` for Node into `work`, and loads it. */
export const serverTheme = async (repo: string, work: string): Promise<ServerTheme> => {
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const source = entrySource(await readFile(join(repo, 'routes.json'), 'utf8'), await readContent(repo))
  const outfile = join(work, 'server.cjs')
  await build({
    absWorkingDir: repo,
    stdin: { contents: `export * from '${entryName}'`, resolveDir: repo, loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    jsx: 'automatic',
    // Minified as the client bundle is, so CSS Modules get the same class names in the HTML and the stylesheet.
    minify: true,
    outfile,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [
      resolveOwn(),
      { name: 'df-server-entry', setup: (b) => void b.onLoad({ filter: /.*/, namespace: 'df' }, () => ({ contents: source, loader: 'js', resolveDir: repo })) },
    ],
  })
  return createRequire(import.meta.url)(outfile) as ServerTheme
}
