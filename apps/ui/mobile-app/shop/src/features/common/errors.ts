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
    case 'NO_CART':
      return 'errors.NO_CART'
    case 'TOO_MANY_CODES':
      return 'errors.TOO_MANY_CODES'
    case 'NOT_READY':
      return 'errors.NOT_READY'
    case 'OUT_OF_STOCK':
      return 'errors.OUT_OF_STOCK'
    case 'OFFER_CHANGED':
      return 'errors.OFFER_CHANGED'
    case 'CART_CHANGED':
      return 'errors.CART_CHANGED'
    case 'ALREADY_PLACED':
      return 'errors.ALREADY_PLACED'
    case 'METHOD_UNAVAILABLE':
      return 'errors.METHOD_UNAVAILABLE'
    case 'PHONE_REQUIRED':
      return 'errors.PHONE_REQUIRED'
    case 'SHIPPING_UNAVAILABLE':
      return 'errors.SHIPPING_UNAVAILABLE'
    default:
      return 'errors.UNKNOWN'
  }
}
