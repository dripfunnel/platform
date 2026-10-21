import { loadAccess } from '../../../api/products'
import { loadShopHost } from '../../../api/storefront'
import { loadDesign, type DesignOverview } from '../../../api/studio'
import { loadBrand, loadSeo, loadTemplates, type StorefrontBrand, type StorefrontSeo, type StorefrontTemplate } from '../../../api/storefrontSettings'
import type { ApiClient } from '../../../graphql'
import { storefrontAccessOf, type StorefrontAccess } from '../access'

export type DesignerData = { overview: DesignOverview; host: string | null; templates: StorefrontTemplate[]; brand: StorefrontBrand | null; seo: StorefrontSeo | null }

/** The seat first. Only the Owner is asked for the brand, to know whether "Your brand" comes first; the names and the address only dress the screen. */
export const loadDesigner = async (client: ApiClient, readOnly: boolean): Promise<{ access: StorefrontAccess; data: DesignerData | null }> => {
  const access = storefrontAccessOf(await loadAccess(client), readOnly)
  if (!access.canRead) return { access, data: null }
  const [overview, host, templates, brand] = await Promise.all([loadDesign(client), loadShopHost(client).catch(() => null), loadTemplates(client).catch(() => []), access.canEdit ? loadBrand(client) : Promise.resolve(null)])
  const seo = access.canEdit && brand?.brandReady !== true ? await loadSeo(client).catch(() => null) : null
  return { access, data: { overview, host, templates, brand, seo } }
}
