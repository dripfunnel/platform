import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// Settings › Store info (SetStore; FIRST-RELEASE (store) §15): the store's details, its currencies and its languages.

const addressSchema = z.object({ street: z.string().nullable(), city: z.string().nullable(), postal: z.string().nullable(), region: z.string().nullable() })

const infoSchema = z.object({
  name: z.string(),
  legalName: z.string().nullable(),
  description: z.string().nullable(),
  logoAssetId: z.string().nullable(),
  address: addressSchema.nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
  timeZone: z.string(),
  unitSystem: z.enum(['metric', 'imperial']).catch('metric'),
  orderPrefix: z.string().nullable(),
  nextOrderNumber: z.string(),
})
export type StoreInfo = z.infer<typeof infoSchema>

export const loadStoreInfo = async (client: ApiClient): Promise<StoreInfo | null> =>
  (
    await typedQuery(client)(
      '{ storeInfo { name legalName description logoAssetId address { street city postal region } contactEmail contactPhone country taxId timeZone unitSystem orderPrefix nextOrderNumber } }',
      z.object({ storeInfo: infoSchema.nullable() }),
    )
  ).storeInfo

export type StoreInfoInput = {
  name: string
  legalName: string
  description: string
  logoAssetId: string | null
  address: { street: string; city: string; postal: string; region: string }
  contactEmail: string
  contactPhone: string
  taxId: string
  timeZone: string
  unitSystem: 'metric' | 'imperial'
  orderPrefix: string
  nextOrderNumber: number
}

export const saveStoreInfo = async (client: ApiClient, input: StoreInfoInput): Promise<void> => {
  await typedQuery(client)('mutation SaveStoreInfo($input: StoreInfoInput!) { saveStoreInfo(input: $input) }', z.object({ saveStoreInfo: z.boolean().nullable() }), { input })
}

export const currencyModes = ['convert', 'manual'] as const
export const roundings = ['none', 'nearest', 'ends-99'] as const
export type Rounding = (typeof roundings)[number]
export type CurrencyMode = (typeof currencyModes)[number]

const localeSchema = z.object({
  pricingCurrency: z.string().nullable(),
  mainLanguage: z.string().nullable(),
  offeredLanguages: z.array(z.string()),
  currencies: z.array(z.object({ code: z.string(), mode: z.enum(currencyModes), rounding: z.enum(roundings), status: z.string() })),
  languages: z.array(z.object({ code: z.string(), status: z.string() })),
  /** 100 of the pricing currency in each other one under each rounding, worked out by the API (minor units). */
  examples: z.array(
    z.object({
      currency: z.string(),
      publishedOn: z.string().nullable(),
      from: z.object({ amount: z.string(), currency: z.string() }),
      none: z.object({ amount: z.string() }).nullable(),
      nearest: z.object({ amount: z.string() }).nullable(),
      ends99: z.object({ amount: z.string() }).nullable(),
    }),
  ),
})
export type StoreLocale = z.infer<typeof localeSchema>
export type StoreCurrency = StoreLocale['currencies'][number]

/** The pricing currency and the others, the main language and the others, and the API's worked examples at the reference rates in use. */
export const loadLocale = async (client: ApiClient): Promise<StoreLocale | null> =>
  (
    await typedQuery(client)(
      '{ storeLocale { pricingCurrency mainLanguage offeredLanguages currencies { code mode rounding status } languages { code status } examples { currency publishedOn from { amount currency } none { amount } nearest { amount } ends99 { amount } } } }',
      z.object({ storeLocale: localeSchema.nullable() }),
    )
  ).storeLocale

/** Every currency besides the pricing one, in order; one left out is removed and its prices are kept. */
export const saveCurrencies = async (client: ApiClient, currencies: { code: string; mode: CurrencyMode; rounding: Rounding }[]): Promise<void> => {
  await typedQuery(client)('mutation SaveCurrencies($c: [StoreCurrencyInput!]!) { saveCurrencies(currencies: $c) }', z.object({ saveCurrencies: z.boolean().nullable() }), { c: currencies })
}

/** Every language, the main one among them; one left out keeps its translations, hidden. */
export const saveLanguages = async (client: ApiClient, languages: string[], main: string): Promise<void> => {
  await typedQuery(client)('mutation SaveLanguages($l: [String!]!, $m: String!) { saveLanguages(languages: $l, main: $m) }', z.object({ saveLanguages: z.boolean().nullable() }), { l: languages, m: main })
}

const progressSchema = z.object({ products: z.number().int(), untranslated: z.number().int() }).nullable()

/** How many products are translated into each language, of how many: every language in one request. */
export const loadTranslationProgress = async (client: ApiClient, languages: readonly string[]): Promise<Map<string, { products: number; untranslated: number } | null>> => {
  if (languages.length === 0) return new Map()
  const fields = languages.map((_, i) => `l${i}: translationProgress(language: $l${i}) { products untranslated }`).join(' ')
  const params = languages.map((_, i) => `$l${i}: String!`).join(', ')
  const answer = await typedQuery(client)(`query Progress(${params}) { ${fields} }`, z.record(z.string(), progressSchema), Object.fromEntries(languages.map((code, i) => [`l${i}`, code])))
  return new Map(languages.map((code, i) => [code, answer[`l${i}`] ?? null]))
}
