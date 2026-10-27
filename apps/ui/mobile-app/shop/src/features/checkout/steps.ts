import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { problemsOf, type Cart } from '../../api/cart'

export type Step = 'contact' | 'address' | 'delivery' | 'payment' | 'review'

/** The steps of this cart: a cart with nothing to ship has no address or delivery to give. */
export const stepsFor = (cart: Cart): Step[] => (cart.needsShipping ? ['contact', 'address', 'delivery', 'payment', 'review'] : ['contact', 'payment', 'review'])

/** Where a refusal sends the shopper: the cart, or the step that can fix it; null when no step can. */
export type Return = 'cart' | Step | null

// The checkout problems the engine names (apps/api engine/modules/cart/rules.ts), each to the step that fixes it.
const problemReturns: Readonly<Record<string, Exclude<Return, null>>> = {
  EMPTY: 'cart',
  LINE_PROBLEM: 'cart',
  NO_CONTACT: 'contact',
  NO_ADDRESS: 'address',
  TAX_UNAVAILABLE: 'address',
  NO_SHIPPING: 'delivery',
  SHIPPING_UNAVAILABLE: 'delivery',
}

const codeReturns: Readonly<Record<string, Exclude<Return, null>>> = {
  OUT_OF_STOCK: 'cart',
  OFFER_CHANGED: 'cart',
  CART_CHANGED: 'cart',
  NO_CART: 'cart',
  NOT_FOUND: 'cart',
  ALREADY_PLACED: 'cart',
  METHOD_UNAVAILABLE: 'payment',
  PHONE_REQUIRED: 'contact',
}

const order: readonly Exclude<Return, null>[] = ['cart', 'contact', 'address', 'delivery', 'payment', 'review']

/** The earliest step a refusal points back to: a `NOT_READY` by its `problems`, any other refusal by its code. */
export const returnFor = (error: unknown): Return => {
  if (!isApiError(error)) return null
  const { code } = error
  const targets = code === 'NOT_READY' ? problemsOf(error).flatMap((p) => problemReturns[p] ?? []) : [codeReturns[code]].flatMap((c) => (c ? [c] : []))
  return order.find((step) => targets.includes(step)) ?? null
}

/** The message to show on arriving back: a `NOT_READY` that names a delivery problem says so, any other keeps its own code. */
export const refusalCode = (error: unknown): string => {
  if (!isApiError(error)) return 'UNKNOWN'
  if (error.code === 'NOT_READY' && problemsOf(error).includes('SHIPPING_UNAVAILABLE')) return 'SHIPPING_UNAVAILABLE'
  return error.code
}

/** For `useAction`: a refusal that names a step sends the shopper there and is handled; any other is left to be worded where it happened. */
export const sendBack =
  (onRefused: (error: unknown) => void) =>
  (error: unknown): boolean => {
    if (returnFor(error) === null) return false
    onRefused(error)
    return true
  }
