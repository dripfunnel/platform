import type { ApiKey } from '../../../api/settingsDevelopers'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, tryT } from '../../../messages'
import { dotted } from '../dotted'

const words = (key: string, values: Record<string, string | number> = {}): string => tryT(`settings.developers.${key}`, values) ?? key

/** What a key can do, in words; a scope the app has no words for shows as the API names it. */
export const scopeName = (scope: string): string => tryT(`settings.developers.keys.scopes.${scope}`) ?? scope

/** The lines a key's card shows under its name: what it can do and for whom, when it was used and expires, who made it. */
export const keyLines = (key: ApiKey, now: Date, timeZone: string): string[] => {
  const when = (iso: string) => formatDateTime(iso, locale, timeZone)
  const expiry = key.expiresAt === null ? words('keys.noExpiry') : new Date(key.expiresAt) <= now ? words('keys.expired', { time: when(key.expiresAt) }) : words('keys.expiresOn', { time: when(key.expiresAt) })
  const by = key.createdByName === null ? words('keys.byUnknown') : words(key.createdByHere ? 'keys.by' : 'keys.byGone', { name: key.createdByName })
  const oldKey = key.previousWorksUntil !== null && new Date(key.previousWorksUntil) > now ? words('keys.oldWorks', { time: when(key.previousWorksUntil) }) : null
  return [
    dotted([key.scopes.map(scopeName).join(', '), key.supplier ? words('keys.onlySupplier', { name: key.supplier.name }) : words('keys.whole')]),
    dotted([key.lastUsedAt === null ? words('keys.neverUsed') : words('keys.lastUsed', { time: when(key.lastUsedAt) }), expiry]),
    by,
    ...(oldKey ? [oldKey] : []),
  ]
}
