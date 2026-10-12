import { isApiError } from '@dripfunnel/shared/graphql'
import { scratchTemplate, type StorefrontDomains, type StorefrontStatus, type StorefrontTemplate } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { refusalIn } from '../common/refusal'

const words = messages.storefront

/** The store's repo exists, so a new template is a change to the draft and asks about the words first. */
export const hasSite = (status: StorefrontStatus): boolean => status === 'not_published' || status === 'same_as_live' || status === 'unpublished_changes'

/** The gallery comes first for the Owner until a template is picked, and again after the site couldn't be made. */
export const needsTemplate = (status: StorefrontStatus): boolean => status === 'not_started' || status === 'create_failed'

/** Where shoppers reach the live site: the main address once it is live, else the free one. */
export const liveHost = (domains: StorefrontDomains): string | null =>
  (domains.domains.find((d) => d.primary && d.status === 'live') ?? domains.domains.find((d) => d.kind === 'free'))?.host ?? null

/** "Start from scratch" reads as the prototype's "Custom" once it is the store's look. */
export const templateName = (templates: readonly StorefrontTemplate[], key: string | null): string =>
  key === null || key === scratchTemplate ? words.overview.custom : (templates.find((t) => t.key === key)?.name ?? key)

export const discardRefusal = refusalIn(words.overview.refused)

const galleryRefusal = refusalIn(words.gallery.refused)

/** A queued studio names its place in line; anything else is the code's words. */
export const chooseRefusal = (error: unknown): string => {
  const place = isApiError(error, 'STUDIO_QUEUED') ? error.details['place'] : undefined
  return typeof place === 'number' ? fill(words.gallery.refused.STUDIO_QUEUED, { place: String(place) }) : isApiError(error, 'STUDIO_QUEUED') ? words.gallery.refused.STUDIO_UNAVAILABLE : galleryRefusal(error)
}
