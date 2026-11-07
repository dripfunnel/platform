import type { StoreContext } from './access'

// ACCESS.md §8: a partner support session never reads a shopper's name, contact, address or notes (#1340).
export const hiddenFromSupport = '•••••'

export const isSupportCaller = (ctx: StoreContext): boolean => ctx.standing.kind === 'acting' && ctx.standing.caller.support !== undefined

/** The shopper's detail, or the mask to a support session; an empty one stays empty. */
export const shopperDetail = <T extends string | null | undefined>(ctx: StoreContext, value: T): T | string =>
  value !== null && value !== undefined && isSupportCaller(ctx) ? hiddenFromSupport : value
