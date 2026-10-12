import { isApiError } from '@dripfunnel/shared/graphql'
import { socialNetworks, type BrandInput, type SocialNetwork, type StorefrontBrand, type StorefrontSeo } from '../../api/storefront'
import { fill, messages } from '../../messages'

const words = messages.storefront.brand

/** The brand as typed: every field text, the images their asset ids. */
export type BrandForm = Omit<BrandInput, 'logoAssetId'> & { logoAssetId: string | null }

/** The home page's words, which the brand step asks for and Search and sharing keeps (FIRST-RELEASE §14). */
export interface HomeForm {
  title: string
  description: string
}

export const brandFormOf = (b: StorefrontBrand | null): BrandForm => ({
  shopName: b?.shopName ?? '',
  logoAssetId: b?.logoAssetId ?? null,
  faviconAssetId: b?.faviconAssetId ?? null,
  primaryColour: b?.primaryColour ?? null,
  secondaryColour: b?.secondaryColour ?? null,
  tagline: b?.tagline ?? '',
  description: b?.description ?? '',
  social: Object.fromEntries(socialNetworks.map((n) => [n, b?.social[n] ?? ''])) as Record<SocialNetwork, string>,
  contactEmail: b?.contactEmail ?? '',
  contactPhone: b?.contactPhone ?? '',
  contactAddress: { street: b?.contactAddress?.street ?? '', city: b?.contactAddress?.city ?? '', postal: b?.contactAddress?.postal ?? '', region: b?.contactAddress?.region ?? '' },
  voice: b?.voice ?? '',
})

export const homeFormOf = (s: StorefrontSeo | null): HomeForm => ({ title: s?.title ?? '', description: s?.description ?? '' })

/** "Continue to templates" waits for these two; everything else can be skipped (FIRST-RELEASE §14). */
export const brandComplete = (form: BrandForm): form is BrandForm & { logoAssetId: string } => form.shopName.trim() !== '' && form.logoAssetId !== null

/** A colour as the API takes it: `#rgb` or `#rrggbb`, with or without the `#`; anything else stays as typed for the API to refuse. */
export const colourValue = (typed: string): string | null => (typed.trim() === '' ? null : typed.trim())

/** What a colour picker can show: only a full `#rrggbb`. */
export const pickerValue = (colour: string | null): string => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(colour?.trim() ?? '')
  if (!m?.[1]) return '#000000'
  const hex = m[1].toLowerCase()
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`
}

export const brandInputOf = (form: BrandForm & { logoAssetId: string }): BrandInput => ({ ...form, shopName: form.shopName.trim(), primaryColour: colourValue(form.primaryColour ?? ''), secondaryColour: colourValue(form.secondaryColour ?? '') })

/** A refusal, at the field it names when there is one: the brand's fields, `logo` and `favicon`, and the home page's. */
export interface FormProblem {
  field: string | null
  text: string
}

const fieldOf = (error: unknown): string | null => {
  if (!isApiError(error)) return null
  const field = error.details['field']
  if (typeof field === 'string') return field
  return error.code === 'INVALID_EMAIL' ? 'contactEmail' : null
}

const invalidText = (field: string | null): string => {
  if (field === 'shopName') return words.invalid.shopName
  if (field === 'primaryColour' || field === 'secondaryColour') return words.invalid.colour
  if (field === 'contactAddress') return words.invalid.contactAddress
  const network = socialNetworks.find((n) => field === `social.${n}`)
  if (network) return fill(words.invalid.social, { network: words.social[network] })
  return words.invalid.other
}

/** The API's refusal in the brand's words, kept with the field it is about. */
export const brandProblemOf = (error: unknown, refused: Record<string, string> & { other: string }): FormProblem => {
  const field = fieldOf(error)
  if (!isApiError(error)) return { field: null, text: refused.other }
  if (error.code === 'INVALID_INPUT') return { field, text: invalidText(field) }
  return { field, text: refused[error.code] ?? refused.other }
}
