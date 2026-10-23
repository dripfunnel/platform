import { loadAccess } from '../../api/products'
import { loadStoreTimeZone } from '../../api/storeInfo'
import { loadLatestRequest, loadOverview, loadShopHost, type StorefrontOverview } from '../../api/storefront'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { storefrontAccessOf, type StorefrontAccess } from './access'

export type StorefrontData = { overview: StorefrontOverview; host: string | null; request: string | null; timeZone: string }

/** The seat first: a seat without `storefront.read` is told so before anything is read. The host, the draft's request and the time zone only dress the screen, so their failure takes nothing away. */
export const loadPage = async (client: ApiClient, readOnly: boolean): Promise<{ access: StorefrontAccess; data: StorefrontData | null }> => {
  const access = storefrontAccessOf(await loadAccess(client), readOnly)
  if (!access.canRead) return { access, data: null }
  const [overview, host, timeZone] = await Promise.all([loadOverview(client), loadShopHost(client).catch(() => null), loadStoreTimeZone(client).catch(() => null)])
  const request = overview.draft ? await loadLatestRequest(client).catch(() => null) : null
  return { access, data: { overview, host, request, timeZone: timeZone ?? 'UTC' } }
}
