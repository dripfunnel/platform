import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// The store's brand from the Shop API's `store` (apps/api schema/shop.graphql): its name and logo. Colours and font are not
// served yet (docs/mobile-app/shop/ARCHITECTURE.md §4), so the app keeps DripFunnel's palette.
export const brandSchema = z.object({ name: z.string().nullable(), logo: z.string().nullable(), mark: z.string().nullable() })

export type Brand = z.infer<typeof brandSchema>

const image = z.object({ url: z.string().nullable() }).nullable()

const storeAnswer = z.object({ store: z.object({ name: z.string().nullable(), logo: image, favicon: image }).nullable() })

export const brandFrom = (data: unknown): Brand | null => {
  const { store } = decode(storeAnswer, data)
  return store ? { name: store.name, logo: store.logo?.url ?? null, mark: store.favicon?.url ?? null } : null
}

export const fetchBrand = async (client: ApiClient): Promise<Brand | null> => brandFrom(await client.request<unknown>('{ store { name logo { url } favicon { url } } }', undefined, { get: true }))

const countryAnswer = z.object({ store: z.object({ address: z.object({ country: z.string().nullable() }).nullable() }).nullable() })

/** The store's country, for a wallet's merchant country (Google Pay, Apple Pay); null when the store has none or the read fails. Never kept on the device. */
export const fetchStoreCountry = async (client: ApiClient): Promise<string | null> => {
  const { store } = decode(countryAnswer, await client.request<unknown>('{ store { address { country } } }', undefined, { get: true }))
  const country = store?.address?.country ?? null
  return country && /^[A-Z]{2}$/.test(country) ? country : null
}
