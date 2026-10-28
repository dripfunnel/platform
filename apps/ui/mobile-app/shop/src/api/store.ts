import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

const countryAnswer = z.object({ store: z.object({ address: z.object({ country: z.string().nullable() }).nullable() }).nullable() })

/** The store's country, for a wallet's merchant country (Google Pay, Apple Pay); null when the store has none or the read fails. Never kept on the device. */
export const fetchStoreCountry = async (client: ApiClient): Promise<string | null> => {
  const { store } = decode(countryAnswer, await client.request<unknown>('{ store { address { country } } }', undefined, { get: true }))
  const country = store?.address?.country ?? null
  return country && /^[A-Z]{2}$/.test(country) ? country : null
}
