import type { ActivityChange, ActivityEntry } from '../../api/activity'
import { activityActions, isActionCode } from '../../api/activityActions'
import { fill, messages } from '../../messages'

const words = messages.activity

// Who did it, as one name: an impersonating agent with the account, a support session as its agent (LOGGING.md §4).
export const whoOf = (entry: ActivityEntry): string => {
  const agent = entry.onBehalfOf?.label
  if (!agent) return entry.actor.label
  return entry.actor.kind === 'support_session' ? agent : fill(words.row.actingAs, { agent, actor: entry.actor.label })
}

// The plain-words sentence for an entry, never its code (LOGGING.md §7).
// A code without words reads as the actor and the code itself, so no entry ever disappears.
export const actionText = (entry: ActivityEntry): string => {
  const { action } = entry
  if (!isActionCode(action)) return fill(entry.target ? words.row.unknownWithTarget : words.row.unknown, { actor: whoOf(entry), code: action, target: entry.target?.label ?? '' })
  const text = fill(words.actions[action], {
    actor: whoOf(entry),
    target: entry.target?.label ?? '',
    store: entry.store?.name ?? '',
    partner: entry.partner?.name ?? '',
  })
  const worded = ['write', 'support'].includes(activityActions[action].category)
  if (!worded || entry.result === 'success') return text
  return fill(entry.result === 'denied' ? words.row.refused : words.row.failed, { text })
}

export const entryText = (entry: ActivityEntry): string =>
  entry.reason ? fill(words.row.withReason, { text: actionText(entry), reason: entry.reason }) : actionText(entry)

const marker = '\u0000'

// The sentence split where the target's name goes, so the screen can make that name a link.
export const entryParts = (entry: ActivityEntry): string[] =>
  entry.target ? entryText({ ...entry, target: { ...entry.target, label: marker } }).split(marker) : [entryText(entry)]

export const changeText = (change: ActivityChange): string =>
  change.redacted
    ? fill(words.facts.changedHidden, { field: change.field })
    : fill(words.facts.changed, { field: change.field, before: change.before ?? words.facts.empty, after: change.after ?? words.facts.empty })
