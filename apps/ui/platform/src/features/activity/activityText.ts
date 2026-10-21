import type { ActivityEntry } from '../../api/activity'
import { fill, messages } from '../../messages'

const words = messages.activity
const actions: Record<string, string> = words.actions

// A label is "Name <email>" (LOGGING.md §4); a row names the person, as the prototype does.
export const nameOf = (label: string | null): string => (label ? label.replace(/\s*<[^>]*>\s*$/, '') : words.system)

// Who did it, in one name: support acting as a team member names both (LOGGING.md §4).
export const whoOf = (entry: ActivityEntry): string =>
  entry.through === 'impersonation' && entry.onBehalfOf ? fill(words.asUser, { agent: nameOf(entry.onBehalfOf), user: nameOf(entry.actor.label) }) : nameOf(entry.actor.label)

export const kindOf = (entry: ActivityEntry): string => {
  if (entry.through === 'setup_session') return words.tags.setup_session
  if (entry.through === 'impersonation') return words.tags.impersonation
  return (words.actors as Record<string, string>)[entry.actor.kind] ?? entry.actor.kind
}

// The plain-words sentence (LOGGING.md §7), never only the code: a code without words still names
// who did it, so no entry disappears.
export const entryText = (entry: ActivityEntry): string => {
  const template = actions[entry.action]
  const actor = whoOf(entry)
  const text = template ? fill(template, { actor, target: entry.target ? nameOf(entry.target.label) : '' }) : fill(words.row.unknown, { actor, code: entry.action })
  const outcome = entry.result === 'success' ? text : fill(entry.result === 'denied' ? words.row.refused : words.row.failed, { text })
  return entry.reason ? fill(words.row.withReason, { text: outcome, reason: entry.reason }) : outcome
}

export const actionCodes = Object.keys(actions)
