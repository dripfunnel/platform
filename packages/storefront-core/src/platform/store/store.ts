import { z } from 'zod'
import { ShopApiError, type ShopClient } from '../api/client'

// The store settings every page needs, read once per page (storefront ARCHITECTURE §2.1, §4.3).
export const storeQuery = `query Store { store { name description language mainLanguage languages currency pricingCurrency currencies { code } pricesIncludeTax timeZone contactEmail contactPhone logo { url } address { street city region postal country } favicon { url } tagline social { network url } seo { title description image { url } } } }`

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
      favicon: z.object({ url: text }).nullable().optional(),
      tagline: text,
      social: z.array(z.object({ network: text, url: text })).nullable().optional(),
      seo: z.object({ title: text, description: text, image: z.object({ url: text }).nullable().optional() }).nullable().optional(),
    })
    .nullable(),
})

type DecodedStore = NonNullable<z.infer<typeof storeSchema>['store']>

/** The home page's search and sharing (SAAS §9.2): for its <head>, never copied into a theme. */
export type StoreSeo = { title: string | null; description: string | null; image: { url: string } | null }

export type ShopStoreSettings = Omit<DecodedStore, 'name' | 'language' | 'mainLanguage' | 'currency' | 'pricingCurrency' | 'pricesIncludeTax' | 'timeZone' | 'currencies' | 'logo' | 'favicon' | 'tagline' | 'social' | 'seo'> & {
  currencies: { code: string }[]
  logo: { url: string } | null
  favicon: { url: string } | null
  tagline: string | null
  /** Each an https profile address (instagram, facebook, x, youtube, tiktok, whatsapp). */
  social: { network: string; url: string }[]
  seo: StoreSeo | null
  name: string
  language: string
  mainLanguage: string
  currency: string
  pricingCurrency: string
  pricesIncludeTax: boolean
  timeZone: string
}

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
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
    favicon: s.favicon?.url ? { url: s.favicon.url } : null,
    tagline: s.tagline ?? null,
    // A link is shown only once it parses as https (the brand's own rule, DATA-MODEL §7.8).
    social: (s.social ?? []).flatMap((l) => (l.network && l.url && isHttps(l.url) ? [{ network: l.network, url: l.url }] : [])),
    seo: s.seo ? { title: s.seo.title ?? null, description: s.seo.description ?? null, image: s.seo.image?.url ? { url: s.seo.image.url } : null } : null,
  }
}

/** The store, or null when the Shop API has none for this host or key (a closed or unknown shop). */
export const loadStore = async (client: ShopClient): Promise<ShopStoreSettings | null> => {
  const { store } = await client.query(storeQuery, storeSchema)
  return store ? completeStore(store) : null
}
