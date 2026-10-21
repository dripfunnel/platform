import { socialNetworks, type BrandInput, type SocialNetwork, type StorefrontBrand } from '../../../api/storefrontSettings'
import { isApiError } from '../../../graphql'
import { t } from '../../../messages'

// The brand as typed (FIRST-RELEASE (store) §14): every field text, the two images their asset ids.

export type BrandForm = Omit<BrandInput, 'logoAssetId'> & { logoAssetId: string | null }

export const brandFormOf = (brand: StorefrontBrand | null): BrandForm => ({
  shopName: brand?.shopName ?? '',
  logoAssetId: brand?.logoAssetId ?? null,
  faviconAssetId: brand?.faviconAssetId ?? null,
  primaryColour: brand?.primaryColour ?? null,
  secondaryColour: brand?.secondaryColour ?? null,
  tagline: brand?.tagline ?? '',
  description: brand?.description ?? '',
  social: Object.fromEntries(socialNetworks.map((network) => [network, brand?.social[network] ?? ''])) as Record<SocialNetwork, string>,
  contactEmail: brand?.contactEmail ?? '',
  contactPhone: brand?.contactPhone ?? '',
  contactAddress: { street: brand?.contactAddress?.street ?? '', city: brand?.contactAddress?.city ?? '', postal: brand?.contactAddress?.postal ?? '', region: brand?.contactAddress?.region ?? '' },
  voice: brand?.voice ?? '',
})

/** "Continue to templates" waits for these two; everything else can be skipped. */
export const brandComplete = (form: BrandForm): form is BrandForm & { logoAssetId: string } => form.shopName.trim() !== '' && form.logoAssetId !== null

const colourValue = (typed: string | null): string | null => (typed === null || typed.trim() === '' ? null : typed.trim())

export const brandInputOf = (form: BrandForm & { logoAssetId: string }): BrandInput => ({ ...form, shopName: form.shopName.trim(), primaryColour: colourValue(form.primaryColour), secondaryColour: colourValue(form.secondaryColour) })

export const isBrandDirty = (form: BrandForm, saved: BrandForm): boolean => JSON.stringify(form) !== JSON.stringify(saved)

/** A refusal, at the field it names when there is one (`shopName`, `primaryColour`, `social.x`…). */
export type FormProblem = { field: string | null; text: string }

const fieldOf = (error: unknown): string | null => {
  if (!isApiError(error)) return null
  const field = error.details['field']
  if (typeof field === 'string') return field
  return error.code === 'INVALID_EMAIL' ? 'contactEmail' : null
}

const invalidText = (field: string | null): string => {
  if (field === 'shopName') return t('storefront.brand.invalid.shopName')
  if (field === 'primaryColour' || field === 'secondaryColour') return t('storefront.brand.invalid.colour')
  if (field === 'contactAddress') return t('storefront.brand.invalid.contactAddress')
  const network = socialNetworks.find((candidate) => field === `social.${candidate}`)
  if (network) return t('storefront.brand.invalid.social', { network: t(`storefront.brand.social.${network}`) })
  return t('storefront.brand.invalid.other')
}

/** The API's refusal in the brand's words, kept with the field it is about. */
export const brandProblemOf = (error: unknown): FormProblem => {
  const field = fieldOf(error)
  if (!isApiError(error)) return { field: null, text: t('storefront.brand.refused.other') }
  if (error.code === 'INVALID_INPUT') return { field, text: invalidText(field) }
  const known = ['INVALID_EMAIL', 'INVALID_IMAGE', 'NOT_FOUND', 'READ_ONLY', 'SUPPORT_READ_ONLY', 'FORBIDDEN'] as const
  const code = known.find((candidate) => candidate === error.code)
  return { field, text: code ? t(`storefront.brand.refused.${code}`) : t('storefront.brand.refused.other') }
}
