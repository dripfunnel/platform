import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ShopContext, useShop, type OrderAccess } from '../../api/ShopContext'
import { Skeleton } from '../common/ui'

const HeadersContext = createContext<Record<string, string>>({})

/** The headers a request for this order's images must carry: the rider's photo answers only the order's own reader. */
export const useOrderHeaders = (): Record<string, string> => useContext(HeadersContext)

/** Everything below reads this order the way its owner does: a guest by the token kept for the order, a customer by the session. */
export function WithOrderAccess({ orderId, children }: { orderId: string; children: ReactNode }) {
  const shop = useShop()
  const { orderAccess } = shop
  const [access, setAccess] = useState<OrderAccess | null>(null)

  useEffect(() => {
    let live = true
    void orderAccess(orderId).then((found) => {
      if (live) setAccess(found)
    })
    return () => {
      live = false
    }
  }, [orderAccess, orderId])

  const scoped = useMemo(() => (access ? { ...shop, client: access.client } : null), [shop, access])
  if (!access || !scoped) return <Skeleton kind="detail" />
  return (
    <HeadersContext.Provider value={access.headers}>
      <ShopContext.Provider value={scoped}>{children}</ShopContext.Provider>
    </HeadersContext.Provider>
  )
}
