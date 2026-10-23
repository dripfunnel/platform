import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { storefrontStatuses } from './storefront'

// The brand step, the template gallery and Search and sharing on the Store API (FIRST-RELEASE (store) §14;
// apps/api src/apis/store/storefrontSettings.ts, storefront.ts): `storefront.read` reads, `publish` (the Owner) writes.

/** The API's own length limits (saas/storefrontSettings/rules.ts), so a field never takes more than a save allows. */
export const brandLimits = { shopName: 80, tagline: 100, description: 300, voice: 60, email: 320, phone: 40, social: 300, street: 200, city: 100, postal: 20, region: 100 } as const
export const seoLimits = { title: 60, description: 155 } as const

export const socialNetworks = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'whatsapp'] as const
export type SocialNetwork = (typeof socialNetworks)[number]

const text = z.string().nullable()
const brandSchema = z.object({
  brandReady: z.boolean(),
  shopName: z.string(),
  logoAssetId: text,
  faviconAssetId: text,
  primaryColour: text,
  secondaryColour: text,
  tagline: text,
  description: text,
  social: z.object({ instagram: text, facebook: text, x: text, youtube: text, tiktok: text, whatsapp: text }),
  contactEmail: text,
  contactPhone: text,
  contactAddress: z.object({ street: text, city: text, postal: text, region: text }).nullable(),
  voice: text,
})
export type StorefrontBrand = z.infer<typeof brandSchema>

const brandFields = 'brandReady shopName logoAssetId faviconAssetId primaryColour secondaryColour tagline description social { instagram facebook x youtube tiktok whatsapp } contactEmail contactPhone contactAddress { street city postal region } voice'

export const loadBrand = async (client: ApiClient): Promise<StorefrontBrand | null> =>
  (await typedQuery(client)(`{ storefrontBrand { ${brandFields} } }`, z.object({ storefrontBrand: brandSchema.nullable() }))).storefrontBrand

export type BrandInput = {
  shopName: string
  logoAssetId: string
  faviconAssetId: string | null
  primaryColour: string | null
  secondaryColour: string | null
  tagline: string
  description: string
  social: Record<SocialNetwork, string>
  contactEmail: string
  contactPhone: string
  contactAddress: { street: string; city: string; postal: string; region: string }
  voice: string
}

/** The whole section at once: a field left empty is cleared (`brandReady` follows a name and a saved logo). */
export const saveBrand = async (client: ApiClient, input: BrandInput): Promise<StorefrontBrand> =>
  (await typedQuery(client)(`mutation Brand($input: StorefrontBrandInput!) { saveStorefrontBrand(input: $input) { ${brandFields} } }`, z.object({ saveStorefrontBrand: brandSchema }), { input })).saveStorefrontBrand

const seoSchema = z.object({ title: text, description: text, shareImageAssetId: text })
export type StorefrontSeo = z.infer<typeof seoSchema>

export const loadSeo = async (client: ApiClient): Promise<StorefrontSeo> =>
  (await typedQuery(client)('{ storefrontSeo { title description shareImageAssetId } }', z.object({ storefrontSeo: seoSchema }))).storefrontSeo

/** Saving renders the home page again at once, using no allowance (FIRST-RELEASE (store) §14). */
export const saveSeo = async (client: ApiClient, input: { title: string; description: string; shareImageAssetId: string | null }): Promise<StorefrontSeo> =>
  (await typedQuery(client)('mutation Seo($input: StorefrontSeoInput!) { saveStorefrontSeo(input: $input) { title description shareImageAssetId } }', z.object({ saveStorefrontSeo: seoSchema }), { input })).saveStorefrontSeo

/** How many product photos the share image is picked from (PortalStorefront › Search and sharing). */
const shareImageChoices = 5

/** The first photo of the most recently changed products that have one: the share image must be a product photo. */
export const loadShareImages = async (client: ApiClient): Promise<string[]> => {
  const list = await typedQuery(client)(
    'query Recent($first: Int!) { products(first: $first, sort: "updated") { nodes { id photoUrl } } }',
    z.object({ products: z.object({ nodes: z.array(z.object({ id: z.string(), photoUrl: text })) }).nullable() }),
    { first: shareImageChoices },
  )
  const ids = (list.products?.nodes ?? []).filter((product) => product.photoUrl !== null).map((product) => product.id)
  if (ids.length === 0) return []
  const fields = ids.map((_, i) => `p${i}: product(id: $p${i}) { photos { assetId } }`).join(' ')
  const params = ids.map((_, i) => `$p${i}: ID!`).join(', ')
  const photos = await typedQuery(client)(`query Photos(${params}) { ${fields} }`, z.record(z.string(), z.object({ photos: z.array(z.object({ assetId: text })).nullable() }).nullable()), Object.fromEntries(ids.map((id, i) => [`p${i}`, id])))
  return ids.map((_, i) => photos[`p${i}`]?.photos?.[0]?.assetId ?? null).filter((id): id is string => id !== null)
}

/** "Start from scratch" is this key, which `storefrontTemplates` lists first. */
export const scratchTemplate = 'baseline'

const templateSchema = z.object({ key: z.string(), name: z.string(), tag: z.string(), description: z.string(), demoUrl: text, current: z.boolean() })
export type StorefrontTemplate = z.infer<typeof templateSchema>

export const loadTemplates = async (client: ApiClient): Promise<StorefrontTemplate[]> =>
  (await typedQuery(client)('{ storefrontTemplates { key name tag description demoUrl current } }', z.object({ storefrontTemplates: z.array(templateSchema) }))).storefrontTemplates

/** The first choice starts making the store's site (`creating`); a later one changes the draft. Answers the new status. */
export const chooseTemplate = async (client: ApiClient, key: string, keepWords: boolean): Promise<(typeof storefrontStatuses)[number]> =>
  (await typedQuery(client)('mutation Pick($key: String!, $keep: Boolean!) { chooseTemplate(key: $key, keepWords: $keep) }', z.object({ chooseTemplate: z.enum(storefrontStatuses) }), { key, keep: keepWords })).chooseTemplate
