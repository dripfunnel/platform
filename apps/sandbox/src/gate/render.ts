import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThemeRoute } from '@dripfunnel/storefront-core'
import { snapshotStoreSchema, type GuardContext } from '@dripfunnel/storefront-core/guard'
import { serverTheme } from '../publish/render'
import { routesSchema } from './bundle'
import type { GateProblem } from './problems'

const problem = (message: string): GateProblem => ({ step: 'render', file: null, line: null, rule: 'render/throws', message: message.slice(0, 1000) })
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The store as a render without shop data sees it: its name and languages, from what the validator was given. */
export const storeOf = (context: GuardContext) => {
  const language = context.locales[0] ?? 'en'
  return snapshotStoreSchema.parse({ name: context.brand.name, description: null, language, mainLanguage: language, languages: context.locales, currency: 'USD', pricingCurrency: 'USD', currencies: [{ code: 'USD' }], pricesIncludeTax: false, timeZone: 'UTC', contactEmail: null, contactPhone: null, logo: null, address: null })
}

/** Each page the theme routes, rendered once with no shop data (its empty state): a page that throws fails the change. */
export const renderCheck = async (repo: string, work: string, context: GuardContext): Promise<GateProblem[]> => {
  const store = storeOf(context)
  const server = await serverTheme(repo, work, '/').catch((error: unknown) => problem(`The theme's pages can't be bundled to render: ${messageOf(error)}`))
  if ('step' in server) return [server]
  const routes = routesSchema.parse(JSON.parse(await readFile(join(repo, 'routes.json'), 'utf8')))
  const pages = [...Object.keys(routes.routes).map((route) => ({ name: `${route} page`, route: route as ThemeRoute, path: null })), ...Object.keys(routes.custom ?? {}).map((path) => ({ name: `page at ${path}`, route: null, path }))]
  const problems: GateProblem[] = []
  for (const page of pages) {
    const Page = server.page(page.route, page.path)
    if (!Page) continue
    await server.render(Page, { store, poweredBy: null, path: page.path ?? '/', answers: null }).catch((error: unknown) => problems.push(problem(`The ${page.name} threw while rendering: ${messageOf(error)}`)))
  }
  return problems
}
