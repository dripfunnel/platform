import { formatDay } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import type { PublishRun, StorefrontOverview, StorefrontVersion } from '../../api/storefront'

/** Where the person goes for what the phone doesn't do: templates and the full designer (DESIGN.md §5). */
export const storefrontPortalPath = '/storefront'

/** What the screen draws for the site: none made yet (or its making failed), being made, or there. */
export type Site = 'none' | 'creating' | 'ready'

export const siteOf = (status: StorefrontOverview['status']): Site => (status === 'not_started' || status === 'create_failed' ? 'none' : status === 'creating' ? 'creating' : 'ready')

export const versionLabel = (version: StorefrontVersion): string =>
  version.label ?? (version.template ? t('storefront.versions.template', { template: version.template }) : t('storefront.versions.fallback', { number: version.number }))

export const versionMeta = (version: StorefrontVersion, timeZone: string): string => t('storefront.versions.meta', { number: version.number, date: formatDay(version.publishedAt, locale, timeZone) })

/** The prototype's three most recent. */
export const recentVersions = (history: readonly StorefrontVersion[]): readonly StorefrontVersion[] => history.slice(0, 3)

/** The number the next publish will take. */
export const nextVersion = (overview: StorefrontOverview): number => Math.max(overview.live?.number ?? 0, ...overview.history.map((version) => version.number)) + 1

/** The live version's number, which Undo and "You can go back" name; null before the first publish. */
export const liveNumber = (overview: StorefrontOverview): number | null => overview.live?.number ?? null

/** The newest publish's end when it went wrong; a live one is no news. */
export type LastPublish = 'failed' | 'rolled_back' | null
export const lastPublishOf = (overview: StorefrontOverview): LastPublish => (overview.lastPublish?.state === 'live' ? null : (overview.lastPublish?.state ?? null))

/** A failed publish says what failed in the checks' own plain words, else a general line. */
export const failureWords = (run: PublishRun | null): string => {
  const words = (run?.checks ?? []).filter((check) => !check.passed && check.words).map((check) => check.words ?? '')
  return words.length > 0 ? words.join(' ') : t('storefront.publish.refusedFallback')
}
