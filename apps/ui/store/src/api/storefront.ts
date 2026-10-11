import { z } from 'zod'
import { query } from './client'

// Storefront › the brand step and Site settings (PortalStorefront, FIRST-RELEASE §14 and §19 "Built on #471";
// apps/api/src/apis/store/storefrontSettings.ts): `storefront.read` reads, `publish` (the Owner) writes.

/** The API's own length limits (saas/storefrontSettings/rules.ts), so a field never takes more than a save allows. */
export const brandLimits = { shopName: 80, tagline: 100, description: 300, voice: 60, email: 320, phone: 40, social: 300, street: 200, city: 100, postal: 20, region: 100 } as const
export const seoLimits = { title: 60, description: 155 } as const

export const socialNetworks = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'whatsapp'] as const
export type SocialNetwork = (typeof socialNetworks)[number]

const text = z.string().nullable()
const addressSchema = z.object({ street: text, city: text, postal: text, region: text })

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
  contactAddress: addressSchema.nullable(),
  voice: text,
})
export type StorefrontBrand = z.infer<typeof brandSchema>

const brandFields = 'brandReady shopName logoAssetId faviconAssetId primaryColour secondaryColour tagline description social { instagram facebook x youtube tiktok whatsapp } contactEmail contactPhone contactAddress { street city postal region } voice'

export const loadBrand = async (): Promise<StorefrontBrand | null> => (await query(`{ storefrontBrand { ${brandFields} } }`, z.object({ storefrontBrand: brandSchema.nullable() }))).storefrontBrand

export interface BrandInput {
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
export const saveBrand = async (input: BrandInput): Promise<StorefrontBrand> =>
  (await query(`mutation B($input: StorefrontBrandInput!) { saveStorefrontBrand(input: $input) { ${brandFields} } }`, z.object({ saveStorefrontBrand: brandSchema }), { input })).saveStorefrontBrand

const seoSchema = z.object({ title: text, description: text, shareImageAssetId: text })
export type StorefrontSeo = z.infer<typeof seoSchema>

export const loadSeo = async (): Promise<StorefrontSeo> => (await query('{ storefrontSeo { title description shareImageAssetId } }', z.object({ storefrontSeo: seoSchema }))).storefrontSeo

/** Saving renders the home page again at once, using no allowance (FIRST-RELEASE §14). */
export const saveSeo = async (input: { title: string; description: string; shareImageAssetId: string | null }): Promise<StorefrontSeo> =>
  (await query('mutation S($input: StorefrontSeoInput!) { saveStorefrontSeo(input: $input) { title description shareImageAssetId } }', z.object({ saveStorefrontSeo: seoSchema }), { input })).saveStorefrontSeo
