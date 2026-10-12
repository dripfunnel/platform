import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { themeRoutesSchema } from '@dripfunnel/storefront-core'
import { checkValidator, edgeCases, gateCheck, gateReport, pageName, validateChange, type CatalogueSnapshot, type GateCheckName, type GateReport, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { bundle, runtimeFolder } from '../gate/bundle'
import { typecheck } from '../gate/typecheck'
import { directionOf, edgeRules, fileOf, pageDocument, plan, robots, sitemap, type PlannedPage } from './pages'
import { serverTheme, type ServerTheme } from './render'

// Step `build` (storefront LIVE-SHOP §4 step 6): the validator over the whole theme, then the static build from the
// frozen snapshot into `site/`, and the same theme against the edge-case catalogue into `edge/{n}/` for the check step.

export type BuildOutcome = { ok: true; pages: number } | { ok: false; report: GateReport }

/** The edge-case renders, each under its own folder beside the site; the check step reads them, nothing uploads them. */
export const edgeFolder = (n: number) => `edge/${n}/`

const write = async (file: string, text: string) => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}

const failed = (problems: string[], name: GateCheckName = 'validator'): BuildOutcome => ({ ok: false, report: gateReport([gateCheck(name, problems)]) })

/** Renders each page; a page whose theme code throws is named, never its error's text (LIVE-SHOP §4 step 5's log). */
const renderPages = async (server: ServerTheme, pages: readonly PlannedPage[], s: CatalogueSnapshot, into: string, assets: { entry: string; css: string[] }, dir?: 'ltr' | 'rtl'): Promise<string[]> => {
  const thrown: string[] = []
  for (const page of pages) {
    const store = { ...s.store, language: page.language }
    const Page = server.page(page.route === 'custom' ? null : page.route, page.custom)
    if (!Page) continue
    let body: string
    try {
      body = server.render(Page, { store, poweredBy: s.poweredBy, path: page.path })
    } catch {
      thrown.push(`The ${pageName(page)} (${page.path}) failed while rendering.`)
      continue
    }
    await write(join(into, fileOf(page.path)), pageDocument(page, s, { body, assets, dir: dir ?? directionOf(page.language), store }))
  }
  return thrown
}

type BuildInput = { repo: string; theme: readonly ThemeFile[]; snapshot: CatalogueSnapshot; runtimeDir: string; out: string; work: string }

/** Builds `theme` (already checked out at `repo`) into `out`; the same theme and snapshot always give the same files. */
export const buildSite = async (input: BuildInput): Promise<BuildOutcome> => {
  const outcome = await buildInto(input)
  // A refusal leaves no part of a site and no edge-case render; the runner reads only site/ and report.json, never .work/.
  if (!outcome.ok) for (const folder of ['site', 'edge']) await rm(join(input.out, folder), { recursive: true, force: true })
  return outcome
}

const buildInto = async (input: BuildInput): Promise<BuildOutcome> => {
  const { snapshot: s, out, work } = input
  const validator = validateChange(input.theme, s.guard).problems
  if (validator.length > 0) return { ok: false, report: gateReport([checkValidator(validator)]) }
  const types = typecheck(new Map(input.theme.map((f) => [f.path, f.content])))
  if (types.length > 0) return failed(types.map((p) => `${p.file ?? 'The theme'}${p.line ? `:${p.line}` : ''}: ${p.message}`))
  const routes = themeRoutesSchema.parse(JSON.parse(input.theme.find((f) => f.path === 'routes.json')?.content ?? '{}'))

  const site = join(out, 'site')
  await rm(site, { recursive: true, force: true })
  await rm(join(out, 'edge'), { recursive: true, force: true })
  const client = await bundle(input.repo, site)
  if (!client.ok) return failed(client.problems.map((p) => `${p.file ?? 'The theme'}: ${p.message}`))
  // The fast gate's page is the studio's; the live site's pages are written below.
  await rm(join(site, 'index.html'))
  await cp(input.runtimeDir, join(site, runtimeFolder), { recursive: true })
  const assets = { entry: client.bundle.entry, css: client.bundle.files.filter((f) => f.path.endsWith('.css')).map((f) => f.path) }

  // esbuild refusing the theme's files is the theme's fault; anything else is the image's, and stops the step instead.
  const server = await serverTheme(input.repo, join(work, 'server')).catch((error: unknown) => {
    if (error instanceof Error && Array.isArray((error as { errors?: unknown }).errors)) return null
    throw error
  })
  if (!server) return failed(["The theme's pages can't be bundled for the static build."], 'contracts')
  const pages = plan(routes, s.store)
  const thrown = await renderPages(server, pages, s, site, assets)
  if (thrown.length > 0) return failed(thrown, 'contracts')
  await write(join(site, 'sitemap.xml'), sitemap(pages, s.origin))
  await write(join(site, 'robots.txt'), robots(s.origin))
  await write(join(site, '_edge.json'), `${JSON.stringify(edgeRules(pages, s.store))}\n`)

  const main = pages.filter((p) => p.language === s.store.mainLanguage)
  for (const [n, edge] of edgeCases(s).entries()) {
    const language = edge.snapshot.store.language
    const edgeThrown = await renderPages(server, main.map((p) => ({ ...p, language })), edge.snapshot, join(out, edgeFolder(n)), assets, edge.dir)
    if (edgeThrown.length > 0) return failed(edgeThrown.map((t) => `With ${edge.name}: ${t}`), 'edge-cases')
  }
  return { ok: true, pages: pages.length }
}
