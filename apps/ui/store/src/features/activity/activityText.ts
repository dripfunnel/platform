import type { ActivityEntry } from '../../api/activity'
import { fill, messages } from '../../messages'
import { productName } from '../common/productName'

const words = messages.activity
const actions: Record<string, string> = words.actions

/** A label is "Name <email>" (LOGGING §4); a row names the person, as StoreActivity does. */
export const nameOf = (label: string | null): string => (label ? label.replace(/\s*<[^>]*>\s*$/, '') : words.system)

/** Who did it: for a support session, the agent behind it (ACCESS §8, "Attribution"). */
export const actorOf = (entry: ActivityEntry): string => (entry.actor.kind === 'support_session' && entry.onBehalfOf ? nameOf(entry.onBehalfOf.label) : nameOf(entry.actor.label))

/** The person filter's key for whoever did it: the session for support, as the API filters it. */
export const personOf = (entry: ActivityEntry): { kind: string; id: string } | null => (entry.actor.id ? { kind: entry.actor.kind, id: entry.actor.id } : null)

export const kindOf = (kind: string): string => fill((words.kinds as Record<string, string>)[kind] ?? kind, { partner: productName() })

/** What was done, after the actor's name; a code the portal doesn't word yet names itself, so no entry disappears. */
export const doneOf = (entry: ActivityEntry): string => {
  const template = actions[entry.action]
  if (!template) return fill(words.other, { action: entry.action })
  return fill(template, { target: entry.target?.label ? nameOf(entry.target.label) : words.someone })
}

/** Where an entry's target opens in the portal, when it has a screen. */
export const targetLink = (entry: ActivityEntry): { to: '/products/$productId'; params: { productId: string } } | { to: '/orders/$orderId'; params: { orderId: string } } | null => {
  const id = entry.target?.id
  if (!id) return null
  if (entry.target?.type === 'product') return { to: '/products/$productId', params: { productId: id } }
  if (entry.target?.type === 'order') return { to: '/orders/$orderId', params: { orderId: id } }
  return null
}
