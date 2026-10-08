import { z } from 'zod'
import { ShopApiError, type ShopClient } from '../api/client'

// The store settings every page needs, read once per page (storefront ARCHITECTURE §2.1, §4.3).
export const storeQuery = `query Store { store { name description language mainLanguage languages currency pricingCurrency currencies { code } pricesIncludeTax timeZone contactEmail contactPhone logo { url } address { street city region postal country } } }`

const text = z.string().nullable().optional()

// Every ShopStore field is nullable in shop.graphql, so the decoder accepts nulls and loadStore
// decides which ones a storefront can't run without.
export const storeSchema = z.object({
  store: z
    .object({
      name: text,
      description: text,
      language: text,
      mainLanguage: text,
      languages: z.array(z.string()).nullable().optional(),
      currency: text,
      pricingCurrency: text,
      currencies: z.array(z.object({ code: text })).nullable().optional(),
      pricesIncludeTax: z.boolean().nullable().optional(),
      timeZone: text,
      contactEmail: text,
      contactPhone: text,
      logo: z.object({ url: text }).nullable().optional(),
      address: z.object({ street: text, city: text, region: text, postal: text, country: text }).nullable().optional(),
    })
    .nullable(),
})

type DecodedStore = NonNullable<z.infer<typeof storeSchema>['store']>

export type ShopStoreSettings = Omit<DecodedStore, 'name' | 'language' | 'mainLanguage' | 'currency' | 'pricingCurrency' | 'pricesIncludeTax' | 'timeZone' | 'currencies' | 'logo'> & {
  currencies: { code: string }[]
  logo: { url: string } | null
  name: string
  language: string
  mainLanguage: string
  currency: string
  pricingCurrency: string
  pricesIncludeTax: boolean
  timeZone: string
}

/** The shopper's language and currency fall back to the store's main ones; the rest are required. */
export const completeStore = (s: DecodedStore): ShopStoreSettings => {
  const { name, mainLanguage, pricingCurrency, pricesIncludeTax, timeZone } = s
  if (!name || !mainLanguage || !pricingCurrency || pricesIncludeTax == null || !timeZone) {
    const missing = Object.entries({ name, mainLanguage, pricingCurrency, pricesIncludeTax, timeZone }).filter(([, v]) => v == null || v === '').map(([k]) => k)
    throw new ShopApiError('STORE_INCOMPLETE', `The Shop API's store has no ${missing.join(', ')}.`)
  }
  return {
    ...s,
    name,
    mainLanguage,
    pricingCurrency,
    pricesIncludeTax,
    timeZone,
    language: s.language ?? mainLanguage,
    currency: s.currency ?? pricingCurrency,
    currencies: (s.currencies ?? []).flatMap((c) => (c.code ? [{ code: c.code }] : [])),
    logo: s.logo?.url ? { url: s.logo.url } : null,
  }
}

/** The store, or null when the Shop API has none for this host or key (a closed or unknown shop). */
export const loadStore = async (client: ShopClient): Promise<ShopStoreSettings | null> => {
  const { store } = await client.query(storeQuery, storeSchema)
  return store ? completeStore(store) : null
}
