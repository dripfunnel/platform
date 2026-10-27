import { useCallback, useState } from 'react'
import { cartOperation, type Cart, type CartChange } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { useOperation, type Loaded } from '../common/useOperation'

/**
 * The shopper's cart as the API prices it. A write answers the whole cart, which `apply` puts on screen without asking again;
 * the next read, from a refresh or a retry, replaces it. A guest's new cart token is kept for every later call.
 */
export function useCart(): { state: Loaded<Cart | null>; retry: () => void; refresh: () => void; apply: (change: CartChange) => Promise<void> } {
  const { saveCartToken } = useShop()
  const { state, retry, refresh } = useOperation(cartOperation())
  const [applied, setApplied] = useState<{ over: Loaded<Cart | null>; cart: Cart | null } | null>(null)

  const apply = useCallback(
    async (change: CartChange) => {
      if (change.cartToken) await saveCartToken(change.cartToken)
      setApplied({ over: state, cart: change.cart })
    },
    [state, saveCartToken],
  )

  const shown: Loaded<Cart | null> = applied && applied.over === state && state.status === 'ready' ? { ...state, data: applied.cart } : state
  return { state: shown, retry, refresh, apply }
}
