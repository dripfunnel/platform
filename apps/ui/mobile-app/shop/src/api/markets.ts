import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

/** What the store sells in and speaks, as the Shop API's `store` offers it (shop/ARCHITECTURE.md §4). The main language and the pricing currency come first, as the API orders them. */
export const offersSchema = z.object({ languages: z.array(z.string()).min(1), currencies: z.array(z.string()).min(1) })

export type Offers = z.infer<typeof offersSchema>

const answer = z.object({
  store: z
    .object({
      mainLanguage: z.string().nullable(),
      languages: z.array(z.string()).nullable(),
      pricingCurrency: z.string().nullable(),
      currencies: z.array(z.object({ code: z.string().nullable() })).nullable(),
    })
    .nullable(),
})

const unique = (codes: (string | null | undefined)[]): string[] => [...new Set(codes.filter((code): code is string => Boolean(code)))]

export const offersFrom = (data: unknown): Offers | null => {
  const { store } = decode(answer, data)
  if (!store) return null
  const languages = unique([store.mainLanguage, ...(store.languages ?? [])])
  const currencies = unique([store.pricingCurrency, ...(store.currencies ?? []).map((c) => c.code)])
  return languages.length && currencies.length ? { languages, currencies } : null
}

export const fetchOffers = async (client: ApiClient): Promise<Offers | null> =>
  offersFrom(await client.request<unknown>('{ store { mainLanguage languages pricingCurrency currencies { code } } }', undefined, { get: true }))
