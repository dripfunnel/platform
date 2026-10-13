import type { ShopState } from './client'

// The shopper's cart and session tokens, which the Shop API hands out once (X-Shop-Cart, X-Shop-Session), kept by core in
// the browser (storefront ARCHITECTURE §5). A theme never reads them: it can't reach storage (§3.4).

const keys = { cart: 'df-cart', session: 'df-session' } as const

export type ShopperToken = keyof typeof keys

const stores = (): Storage[] => {
  try {
    return [globalThis.sessionStorage, globalThis.localStorage].filter((s): s is Storage => s !== undefined)
  } catch {
    return []
  }
}

const attempt = <T>(work: () => T, fallback: T): T => {
  try {
    return work()
  } catch {
    return fallback
  }
}

/** The token, from this visit's storage first, then the browser's; undefined where storage is off. */
export const shopperToken = (which: ShopperToken): string | undefined => {
  for (const s of stores()) {
    const found = attempt(() => s.getItem(keys[which]), null)
    if (found) return found
  }
  return undefined
}

/**
 * Keeps a token, or forgets it with null. `remember: false` keeps it for this visit only (a session without "Keep me signed
 * in"); the cart's is remembered, since a cart lives 30 days (FIRST-RELEASE §19).
 */
export const keepShopperToken = (which: ShopperToken, token: string | null, { remember = true }: { remember?: boolean } = {}) => {
  const [visit, browser] = [attempt(() => globalThis.sessionStorage, undefined), attempt(() => globalThis.localStorage, undefined)]
  for (const s of [visit, browser]) attempt(() => s?.removeItem(keys[which]), undefined)
  if (token) attempt(() => (remember ? browser : visit)?.setItem(keys[which], token), undefined)
}

/** The client's `state` in the browser: the tokens as they are when each request is sent. */
export const storedShopState = (): ShopState => ({ cartToken: shopperToken('cart'), sessionToken: shopperToken('session') })

/** The preview's and the studio frame's: a guest's cart only, never a session, as the Shop API treats every caller there (PREVIEW §5 step 5). */
export const guestShopState = (): ShopState => ({ cartToken: shopperToken('cart') })
