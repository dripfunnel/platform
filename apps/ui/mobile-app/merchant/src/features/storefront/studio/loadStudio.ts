import { loadAccess } from '../../../api/products'
import { loadShopHost } from '../../../api/storefront'
import { loadTemplates, type StorefrontTemplate } from '../../../api/storefrontSettings'
import { loadDesign, loadStudioPages, type DesignOverview, type StudioPages } from '../../../api/studio'
import type { ApiClient } from '../../../graphql'
import { storefrontAccessOf, type StorefrontAccess } from '../access'

export type StudioData = { overview: DesignOverview; host: string | null; templates: StorefrontTemplate[]; pages: StudioPages }

const noPages: StudioPages = { product: null, content: [], custom: [] }

/** The seat first: the studio is the Owner's, so any other is told so before anything is read. The names and the page list only dress the screen, so their failure takes nothing away. */
export const loadStudio = async (client: ApiClient, readOnly: boolean): Promise<{ access: StorefrontAccess; data: StudioData | null }> => {
  const access = storefrontAccessOf(await loadAccess(client), readOnly)
  if (!access.canEdit) return { access, data: null }
  const [overview, host, templates, pages] = await Promise.all([loadDesign(client), loadShopHost(client).catch(() => null), loadTemplates(client).catch(() => []), loadStudioPages(client).catch(() => noPages)])
  return { access, data: { overview, host, templates, pages } }
}
