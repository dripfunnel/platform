import { GraphQLError } from 'graphql'
import { DispatchRefused } from '#core/dispatch'
import { unauthenticated } from './scope'

const words: Record<string, string> = {
  FORBIDDEN: 'Not allowed.',
  NOT_FOUND: 'That isn’t here any more.',
  UNAVAILABLE: 'Own delivery isn’t available for this store yet.',
  INVALID_INPUT: 'Something here isn’t valid.',
  OFFLINE: 'Go online first.',
  RATE_LIMITED: 'Too many updates. Try again in a few seconds.',
  TAKEN: 'Another rider already took this order.',
  ON_DELIVERY: 'Finish your current delivery first.',
  NOT_PACKING: 'This order isn’t waiting to be packed.',
  NOT_UNASSIGNED: 'This delivery isn’t waiting for a rider.',
  NOT_CANCELLABLE: 'This delivery can’t be cancelled now.',
  RIDER_HAS_PARCEL: 'A parcel is still with this rider. Finish the delivery first.',
  NOT_ASSIGNED: 'This delivery isn’t waiting to be picked up.',
  NOT_PICKED_UP: 'This delivery isn’t on its way.',
  NOT_HANDED_OVER: 'A supplier hasn’t handed all the items to the store yet.',
  NOT_ENOUGH_STOCK: 'The warehouse hasn’t enough stock for this order. Ask the store.',
  NOT_SHIPPABLE: 'This order can’t ship now. Ask the store.',
  WRONG_CODE: 'That code doesn’t match. Ask the customer again.',
  CODE_LOCKED: 'Too many wrong codes. The store will confirm this delivery.',
  CODE_UNCONFIRMED: 'The code didn’t match. The store will confirm this delivery.',
  CODE_NOT_LOCKED: 'The rider can still confirm this delivery with the customer’s code.',
  CASH_NOT_CONFIRMED: 'Confirm the cash first.',
}

/** Yoga masks an error that is not a GraphQLError, so a refusal's code would never reach the app (DELIVERY §4). */
export const withDispatchCode = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (!(error instanceof DispatchRefused)) throw error
    if (error.code === 'UNAUTHENTICATED') throw unauthenticated()
    throw new GraphQLError(words[error.code] ?? words['INVALID_INPUT'] ?? '', { extensions: { code: error.code } })
  }
}
