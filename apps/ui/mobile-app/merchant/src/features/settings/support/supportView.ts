import type { SupportSession } from '../../../api/settingsSupport'
import { formatDateTime, formatDuration } from '@dripfunnel/mobile-shared/format'
import { locale, t, tryT } from '../../../messages'
import { dotted } from '../dotted'

/** Who it was, and which seat they acted as. */
export const whoOf = (session: SupportSession): string =>
  session.actingAs.supplier
    ? t('settings.support.orgSupplier', { partner: session.partnerName, name: session.actingAs.name, supplier: session.actingAs.supplier })
    : t('settings.support.org', { partner: session.partnerName, name: session.actingAs.name })

export const whyOf = (session: SupportSession): string => (session.ticket ? t('settings.support.ticket', { ticket: session.ticket, reason: session.reason }) : session.reason)

/** How long a session lasted and how it ended when that says something; one still open says until when. */
export const whenOf = (session: SupportSession, now: Date, timeZone: string): string => {
  const start = formatDateTime(session.startedAt, locale, timeZone)
  if (session.endedAt === null && new Date(session.expiresAt) > now) return dotted([start, t('settings.support.openNow', { time: formatDateTime(session.expiresAt, locale, timeZone) })])
  // One past its end that nothing has closed yet timed out.
  const end = session.endedAt ?? session.expiresAt
  const endedBy = session.endedAt ? session.endedBy : 'expired'
  const duration = formatDuration((new Date(end).getTime() - new Date(session.startedAt).getTime()) / 1000, locale)
  const how = (endedBy && tryT(`settings.support.endedBy.${endedBy}`, { duration })) || t('settings.support.lasted', { duration })
  return dotted([start, how])
}

/** Whether support could change things in the session, and who let it. */
export const changesOf = (session: SupportSession, now: Date): { text: string; wrote: boolean } => {
  if (session.access === 'write') return { text: session.allowedBy ? t('settings.support.allowed', { name: session.allowedBy }) : t('settings.support.allowedNoName'), wrote: true }
  if (session.writeRequest?.state === 'denied') return { text: t('settings.support.denied'), wrote: false }
  // Only an open session is still asking; one past its end timed out, as `whenOf` says.
  if (session.writeRequest?.state === 'pending' && session.endedAt === null && new Date(session.expiresAt) > now) return { text: t('settings.support.asking'), wrote: false }
  return { text: t('settings.support.readOnly'), wrote: false }
}
