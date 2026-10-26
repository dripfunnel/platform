import { useEffect, useState, type ReactNode } from 'react'
import { storeHost } from '../graphql/storeHost'
import { loadTokens, saveCartToken } from '../session/tokens'
import { createShopClient } from './client'
import { ShopContext, type Shop } from './ShopContext'

// One client for the screens: the tokens are read once, and the client reads the same object on every call.
export function ShopProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<Shop | null>(null)

  useEffect(() => {
    let current = true
    const host = storeHost()
    loadTokens(host).then((tokens) => {
      if (!current) return
      setShop({
        host,
        client: createShopClient(host, tokens),
        saveCartToken: async (token) => {
          tokens.cart = token
          await saveCartToken(host, token)
        },
      })
    })
    return () => {
      current = false
    }
  }, [])

  return shop ? <ShopContext.Provider value={shop}>{children}</ShopContext.Provider> : null
}
