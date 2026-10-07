import { z } from 'zod'
import type { ShopClient } from '../api/client'

// The store settings every page needs, read once per page (storefront ARCHITECTURE §2.1, §4.3).
export const storeQuery = `query Store { store { name description language mainLanguage languages currency pricingCurrency currencies { code } pricesIncludeTax timeZone contactEmail contactPhone logo { url } address { street city region postal country } } }`

const text = z.string().nullable().optional()

export const storeSchema = z.object({
  store: z
    .object({
      name: z.string(),
      description: text,
      language: z.string(),
      mainLanguage: z.string(),
      languages: z.array(z.string()).nullable().optional(),
      currency: z.string(),
      pricingCurrency: z.string(),
      currencies: z.array(z.object({ code: z.string() })).nullable().optional(),
      pricesIncludeTax: z.boolean(),
      timeZone: z.string(),
      contactEmail: text,
      contactPhone: text,
      logo: z.object({ url: z.string() }).nullable().optional(),
      address: z.object({ street: text, city: text, region: text, postal: text, country: text }).nullable().optional(),
    })
    .nullable(),
})

export type ShopStoreSettings = NonNullable<z.infer<typeof storeSchema>['store']>

/** The store, or null when the Shop API has none for this host or key (a closed or unknown shop). */
export const loadStore = async (client: ShopClient): Promise<ShopStoreSettings | null> => (await client.query(storeQuery, storeSchema)).store
