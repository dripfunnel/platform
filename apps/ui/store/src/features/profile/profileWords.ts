import { isApiError } from '../../api/client'
import type { MyActivityEntry } from '../../api/profile'
import { fill, messages } from '../../messages'

const words = messages.profile
const actions: Record<string, string> = words.activity.actions

/** The words for a refused profile write, by the API's code (src/apis/store/profile.ts); the rest are the screen's fallback. */
export const profileRefusal = (error: unknown, fallback: string): string => {
  if (!isApiError(error)) return fallback
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return words.twoStep.wrongPassword
    case 'LOCKED':
      return messages.auth.locked.sub
    case 'RATE_LIMITED':
      return messages.auth.rateLimited
    case 'WEAK_PASSWORD':
      return words.password.weak
    case 'NAME_REQUIRED':
      return words.details.nameMissing
    case 'INVALID_EMAIL':
      return words.details.emailBad
    case 'INVALID_PHONE':
      return words.details.phoneBad
    case 'PHONE_IN_USE_FOR_SIGN_IN':
      return words.details.phoneLocked
    case 'PHONE_REQUIRED':
      return words.twoStep.needPhone
    case 'SECOND_FACTOR_REQUIRED':
      return words.twoStep.ownerKeeps
    case 'WRONG_CODE':
      return messages.auth.secondFactor.wrongPlain
    case 'CODE_EXPIRED':
      return words.twoStep.expired
    default:
      return fallback
  }
}

/** One entry of the person's own activity in words; a code this release doesn't word names itself. */
export const activityLine = (entry: Pick<MyActivityEntry, 'action' | 'target'>): string => {
  const template = actions[entry.action]
  if (!template) return fill(words.activity.other, { action: entry.action })
  return fill(template, { target: entry.target?.label ?? words.activity.someone })
}

/** The last four digits of a number, for "the number ending 2113". */
export const lastFour = (phone: string | null): string => (phone ?? '').replace(/\D/g, '').slice(-4)
