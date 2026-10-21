import { seoLimits, type StorefrontSeo } from '../../../api/storefrontSettings'
import { isApiError } from '../../../graphql'
import { t } from '../../../messages'

// The home page's words, which the brand step asks for and Search and sharing keeps (FIRST-RELEASE (store) §14).
export type SeoForm = { title: string; description: string; shareImageAssetId: string | null }

export const seoFormOf = (seo: StorefrontSeo | null): SeoForm => ({ title: seo?.title ?? '', description: seo?.description ?? '', shareImageAssetId: seo?.shareImageAssetId ?? null })

export const seoTooLong = (form: Pick<SeoForm, 'title' | 'description'>): boolean => form.title.length > seoLimits.title || form.description.length > seoLimits.description

export const isSeoDirty = (form: SeoForm, saved: SeoForm): boolean => form.title !== saved.title || form.description !== saved.description || form.shareImageAssetId !== saved.shareImageAssetId

export const seoProblemText = (error: unknown): string => {
  if (!isApiError(error)) return t('storefront.seo.refused.other')
  const known = ['INVALID_INPUT', 'INVALID_IMAGE', 'READ_ONLY', 'SUPPORT_READ_ONLY', 'FORBIDDEN'] as const
  const code = known.find((candidate) => candidate === error.code)
  return code ? t(`storefront.seo.refused.${code}`) : t('storefront.seo.refused.other')
}
