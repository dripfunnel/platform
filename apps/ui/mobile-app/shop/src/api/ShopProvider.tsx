import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { storeHost } from '@dripfunnel/mobile-shared/brand'
import { unregisterThisPhone } from '../push/push'
import { clearCartToken, clearSessionToken, keepOrderToken, loadOrderToken, loadTokens, saveCartToken, saveSessionToken, shopHeaders, type Tokens } from '../session/tokens'
import { createShopClient } from './client'
import { ShopContext, type Shop } from './ShopContext'

type Loaded = { host: string; tokens: Tokens; client: ReturnType<typeof createShopClient> }

// One client for the screens: the tokens are read once, and the client reads the same object on every call.
export function ShopProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let current = true
    const host = storeHost()
    loadTokens(host).then((tokens) => {
      if (!current) return
      setLoaded({ host, tokens, client: createShopClient(host, tokens) })
      setSignedIn(tokens.session !== null)
    })
    return () => {
      current = false
    }
  }, [])

  const shop = useMemo<Shop | null>(() => {
    if (!loaded) return null
    const { host, tokens, client } = loaded
    return {
      host,
      client,
      signedIn,
      saveCartToken: async (token) => {
        tokens.cart = token
        await saveCartToken(host, token)
      },
      startSession: async (token) => {
        tokens.session = token
        tokens.cart = null
        setSignedIn(true)
        await Promise.all([saveSessionToken(host, token), clearCartToken(host)])
      },
      endSession: async () => {
        // Best effort: a phone with no signal must still be able to sign out, so the token goes either way. The phone stops getting this customer's pushes first (api/DELIVERY.md §6).
        await unregisterThisPhone(client).catch(() => undefined)
        await client.request('mutation { signOut }').catch(() => undefined)
        tokens.session = null
        setSignedIn(false)
        await clearSessionToken(host)
      },
      keepOrderToken: (orderId) => keepOrderToken(host, orderId),
      orderAccess: async (orderId) => {
        const kept = await loadOrderToken(host, orderId)
        if (!kept) return { client, headers: shopHeaders(tokens) }
        const own = { ...tokens, cart: kept }
        return { client: createShopClient(host, own), headers: shopHeaders(own) }
      },
    }
  }, [loaded, signedIn])

  return shop ? <ShopContext.Provider value={shop}>{children}</ShopContext.Provider> : null
}
