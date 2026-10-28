import { useCallback, useEffect, useState } from 'react'
import { useShop } from '../api/ShopContext'
import { askAndRegister, hasAsked, markAsked, pushIsSetUp, pushPermission, registerIfGranted } from './push'

/**
 * The offer to turn notifications on, shown once after an order and never at launch. A phone that already allows them is registered
 * for a guest's order without asking; a customer's phone is registered for every order.
 */
export function usePushAsk(orderId: string, guest: boolean) {
  const { client, orderAccess } = useShop()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!pushIsSetUp()) return
    let live = true
    const check = async () => {
      const permission = await pushPermission()
      if (permission === 'granted') {
        if (guest) await registerIfGranted((await orderAccess(orderId)).client, orderId)
        return
      }
      if (permission === 'undetermined' && !(await hasAsked()) && live) setShow(true)
    }
    check().catch(() => undefined)
    return () => {
      live = false
    }
  }, [orderId, guest, orderAccess])

  const enable = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    const reader = guest ? (await orderAccess(orderId)).client : client
    const result = await askAndRegister(reader, guest ? orderId : null)
    setBusy(false)
    if (result === 'failed') return setFailed(true)
    await markAsked()
    setShow(false)
  }, [client, guest, orderAccess, orderId])

  const later = useCallback(async () => {
    await markAsked()
    setShow(false)
  }, [])

  return { show, busy, failed, enable, later }
}
