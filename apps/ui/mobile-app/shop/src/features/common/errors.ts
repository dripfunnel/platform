import type { MessageKey } from '../../messages'

/** A refusal's words by its code (errors are worded by code, never by the API's English). */
export const errorKey = (code: string): MessageKey => {
  switch (code) {
    case 'NO_RESPONSE':
      return 'errors.NO_RESPONSE'
    case 'UNAVAILABLE':
      return 'errors.UNAVAILABLE'
    case 'RATE_LIMITED':
      return 'errors.RATE_LIMITED'
    case 'INVALID_INPUT':
      return 'errors.INVALID_INPUT'
    case 'STORE_UNAVAILABLE':
      return 'errors.STORE_UNAVAILABLE'
    case 'TOO_MANY_LINES':
      return 'errors.TOO_MANY_LINES'
    case 'METHOD_OFF':
      return 'errors.METHOD_OFF'
    case 'CODE_REFUSED':
      return 'errors.CODE_REFUSED'
    case 'SIGN_IN_REFUSED':
      return 'errors.SIGN_IN_REFUSED'
    case 'WEAK_PASSWORD':
      return 'errors.WEAK_PASSWORD'
    case 'TOO_MANY':
      return 'errors.TOO_MANY'
    case 'NOT_FOUND':
      return 'errors.NOT_FOUND'
    case 'SIGNED_OUT':
      return 'errors.SIGNED_OUT'
    case 'NOT_IN_PREVIEW':
      return 'errors.NOT_IN_PREVIEW'
    default:
      return 'errors.UNKNOWN'
  }
}
