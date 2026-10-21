import type { ActionPermission } from '../../api/partners'
import { fill, formatCount, locale, messages, plural } from '../../messages'

const words = messages.partners

export type RefusableAction = keyof typeof words.verbs

// Words for the API's refusal code. Whether the action is refused is the API's answer; this
// only says it in the console's words.
export const refusalText = (permission: ActionPermission, action: RefusableAction, partnerName: string): string | null => {
  if (permission.allowed) return null
  switch (permission.reason) {
    case 'HOUSE_PARTNER':
    case 'SET_UP_BY_CALLER':
    case 'ALREADY_APPROVED_BY_CALLER':
      return fill(words.refusals[permission.reason], { name: partnerName })
    case 'GO_LIVE_CHECKS_FAILING': {
      const failing = permission.failingChecks
      return fill(plural(words.refusals.GO_LIVE_CHECKS_FAILING, failing.length), {
        count: formatCount(failing.length),
        checks: new Intl.ListFormat(locale, { type: 'conjunction' }).format(failing.map((check) => words.checks[check])),
      })
    }
    default:
      return fill(words.refusals[permission.reason], { verb: words.verbs[action] })
  }
}
