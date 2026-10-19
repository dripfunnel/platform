import type { ActivityEntry } from '../../api/activity'
import { t, tryT } from '../../messages'
import type { Seat } from '../../nav'
import { orderHref } from '../orders/routes'
import { productHref } from '../products/routes'

/** A label is "Name <email>" (LOGGING.md §4); a row names the person and never their address. */
export const nameOf = (label: string | null): string => {
  if (!label) return t('activity.system')
  const name = label.replace(/\s*<[^>]*>\s*$/, '')
  return /^[^\s@<>]+@[^\s@<>]+$/.test(name) ? t('activity.unnamed') : name
}

/** Who did it: for a support session, the agent behind it (ACCESS.md §8, "Attribution"). */
export const actorOf = (entry: ActivityEntry): string => (entry.actor.kind === 'support_session' && entry.onBehalfOf ? nameOf(entry.onBehalfOf.label) : nameOf(entry.actor.label))

/** Whose entries a person filter shows: a support session's are that session's, not all of its agent's. */
export const whoseOf = (entry: ActivityEntry): string => (entry.actor.kind === 'support_session' ? t('activity.sessionOf', { name: actorOf(entry) }) : actorOf(entry))

/** The person filter's key for whoever did it, as the API filters it. */
export const personOf = (entry: ActivityEntry): { kind: string; id: string } | null => (entry.actor.id ? { kind: entry.actor.kind, id: entry.actor.id } : null)

export const kindOf = (kind: string, partner: string): string => tryT(`activity.kinds.${kind}`, { partner }) ?? kind

/** What was done, after the actor's name; a code the app has no words for names itself, so no entry disappears. */
export const doneOf = (entry: ActivityEntry): string => {
  const target = entry.target?.label ? nameOf(entry.target.label) : t('activity.someone')
  return tryT(`activity.actions.${entry.action}`, { target }) ?? t('activity.other', { action: entry.action })
}

/** Where an entry's target opens in the app, when it has a screen of its own. */
export const targetHref = (entry: ActivityEntry, seat: Seat | null): string | null => {
  const id = entry.target?.id
  if (!id) return null
  if (entry.target?.type === 'product') return productHref(seat, id)
  if (entry.target?.type === 'order') return orderHref(id)
  return null
}
