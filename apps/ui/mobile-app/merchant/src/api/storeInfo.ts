import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

/** The store's time zone, or null when the API has none; each screen chooses what to show then. */
export const loadStoreTimeZone = async (client: ApiClient): Promise<string | null> =>
  (await typedQuery(client)('{ storeInfo { timeZone } }', z.object({ storeInfo: z.object({ timeZone: z.string() }).nullable() }))).storeInfo?.timeZone ?? null
