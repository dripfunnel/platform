import type { ApiKey, WebhookDelivery, WebhookEndpoint } from '../../../api/settingsDevelopers'
import { formatDateTime, formatNumber } from '../../../format'
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

/** How an endpoint stands, and for a failing or turned-off one the sentence that says since when. */
export const hookState = (hook: WebhookEndpoint, timeZone: string): { tone: 'ok' | 'wait' | 'off'; status: string; line: string | null } => {
  const when = (iso: string) => formatDateTime(iso, locale, timeZone)
  if (hook.status === 'disabled') return { tone: 'off', status: words('hooks.status.disabled'), line: hook.disabledAt ? words('hooks.disabled', { time: when(hook.disabledAt) }) : words('hooks.disabledNoTime') }
  if (hook.status === 'failing') return { tone: 'wait', status: words('hooks.status.failing'), line: hook.failingSince ? words('hooks.failingSince', { time: when(hook.failingSince) }) : words('hooks.failingNoTime') }
  return { tone: 'ok', status: words('hooks.status.active'), line: null }
}

/** What happened to one delivery: the server's code, or what stopped it. */
export const outcomeOf = (delivery: WebhookDelivery): { text: string; failed: boolean } => {
  if (delivery.status === 'pending') return { text: words('hooks.outcome.pending'), failed: false }
  if (delivery.status === 'held') return { text: words('hooks.outcome.held'), failed: false }
  if (delivery.responseCode !== null) return { text: String(delivery.responseCode), failed: delivery.status === 'failed' }
  if (delivery.status === 'delivered') return { text: words('hooks.outcome.delivered'), failed: false }
  // `error` is the server's string: only a code the app has words for is shown, never the string itself.
  return { text: (delivery.error ? tryT(`settings.developers.hooks.outcome.${delivery.error}`) : undefined) ?? words('hooks.outcome.failed'), failed: true }
}

export const durationOf = (ms: number | null): string | null => {
  if (ms === null) return null
  if (ms < 1000) return words('hooks.duration.ms', { count: formatNumber(ms, locale) })
  return words('hooks.duration.s', { count: formatNumber(Math.round(ms / 100) / 10, locale) })
}
