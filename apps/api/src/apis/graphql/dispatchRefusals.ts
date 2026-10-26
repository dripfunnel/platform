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
