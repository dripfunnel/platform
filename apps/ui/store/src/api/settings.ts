import { z } from 'zod'
import { query } from './client'

// Settings › Store info (SetStore, FIRST-RELEASE §15): the store's details, its currencies and its languages.

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
  unitSystem: z.enum(['metric', 'imperial']),
  orderPrefix: z.string().nullable(),
  nextOrderNumber: z.string(),
})
export type StoreInfo = z.infer<typeof infoSchema>

export const loadStoreInfo = async (): Promise<StoreInfo | null> =>
  (
    await query(
      '{ storeInfo { name legalName description logoAssetId address { street city postal region } contactEmail contactPhone country taxId timeZone unitSystem orderPrefix nextOrderNumber } }',
      z.object({ storeInfo: infoSchema.nullable() }),
    )
  ).storeInfo

export interface StoreInfoInput {
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

export const saveStoreInfo = async (input: StoreInfoInput): Promise<void> => {
  await query('mutation S($input: StoreInfoInput!) { saveStoreInfo(input: $input) }', z.object({ saveStoreInfo: z.boolean() }), { input })
}

const localeSchema = z.object({
  pricingCurrency: z.string().nullable(),
  mainLanguage: z.string().nullable(),
  offeredLanguages: z.array(z.string()),
  currencies: z.array(z.object({ code: z.string(), mode: z.enum(['convert', 'manual']), rounding: z.enum(['none', 'nearest', 'ends-99']), status: z.string() })),
  languages: z.array(z.object({ code: z.string(), status: z.string() })),
  rates: z.array(z.object({ currency: z.string(), perEuro: z.string(), publishedOn: z.string() })),
  /** 100 of the pricing currency in each other one under each rounding, worked out by the API (minor units). */
  examples: z.array(
    z.object({
      currency: z.string(),
      from: z.object({ amount: z.string(), currency: z.string() }),
      none: z.object({ amount: z.string() }).nullable(),
      nearest: z.object({ amount: z.string() }).nullable(),
      ends99: z.object({ amount: z.string() }).nullable(),
    }),
  ),
})
export type StoreLocale = z.infer<typeof localeSchema>

/** The pricing currency and the others, the main language and the others, and the reference rates in use. */
export const loadLocale = async (): Promise<StoreLocale | null> =>
  (
    await query(
      '{ storeLocale { pricingCurrency mainLanguage offeredLanguages currencies { code mode rounding status } languages { code status } rates { currency perEuro publishedOn } examples { currency from { amount currency } none { amount } nearest { amount } ends99 { amount } } } }',
      z.object({ storeLocale: localeSchema.nullable() }),
    )
  ).storeLocale

/** Every currency besides the pricing one, in order; one left out is removed (its prices kept, CATALOG O9). */
export const saveCurrencies = async (currencies: { code: string; mode: 'convert' | 'manual'; rounding: 'none' | 'nearest' | 'ends-99' }[]): Promise<void> => {
  await query('mutation C($c: [StoreCurrencyInput!]!) { saveCurrencies(currencies: $c) }', z.object({ saveCurrencies: z.boolean() }), { c: currencies })
}

/** Every language, the main one among them; one left out keeps its translations, hidden (N13). */
export const saveLanguages = async (languages: string[], main: string): Promise<void> => {
  await query('mutation L($l: [String!]!, $m: String!) { saveLanguages(languages: $l, main: $m) }', z.object({ saveLanguages: z.boolean() }), { l: languages, m: main })
}

const progressSchema = z.object({ products: z.number().int(), untranslated: z.number().int() }).nullable()

/** How many products are translated into each language, of how many: every language in one request. */
export const loadTranslationProgress = async (languages: readonly string[]): Promise<Map<string, { products: number; untranslated: number } | null>> => {
  if (languages.length === 0) return new Map()
  const fields = languages.map((_, i) => `l${i}: translationProgress(language: $l${i}) { products untranslated }`).join(' ')
  const params = languages.map((_, i) => `$l${i}: String!`).join(', ')
  const answer = await query(`query P(${params}) { ${fields} }`, z.record(z.string(), progressSchema), Object.fromEntries(languages.map((l, i) => [`l${i}`, l])))
  return new Map(languages.map((l, i) => [l, answer[`l${i}`] ?? null]))
}

export const sectionKeys = ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video'] as const
export type SectionKey = (typeof sectionKeys)[number]

/** Which product page sections the store shows; one the plan lacks can't be switched on (PLAN_LIMIT, P5). */
export const saveSections = async (features: { key: SectionKey; enabled: boolean }[]): Promise<void> => {
  await query('mutation S($f: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $f) { key } }', z.object({ saveCatalogueSettings: z.array(z.object({ key: z.string() })) }), { f: features })
}

export const badgeRules = ['new_30_days', 'top_5_this_month', 'below_compare_price', 'few_left', 'manual'] as const
export type BadgeRule = (typeof badgeRules)[number]

/** A new badge (no id), or a change to one; answers its id. */
/** `position` keeps an edited badge where it is; a new one goes last. */
export const saveBadge = async (id: string | null, input: { label: string; rule: BadgeRule; tone: 'ok' | 'peach' | 'neutral'; position: number }): Promise<string> =>
  (await query('mutation B($id: ID, $input: BadgeInput!) { saveBadge(id: $id, input: $input) }', z.object({ saveBadge: z.string() }), { id, input })).saveBadge

/** Off every product it was on, straight away. */
export const deleteBadge = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteBadge(id: $id) }', z.object({ deleteBadge: z.boolean() }), { id })
}
