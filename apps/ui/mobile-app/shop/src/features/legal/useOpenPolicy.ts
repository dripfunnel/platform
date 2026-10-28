import { useCallback, useState } from 'react'
import { useShop } from '../../api/ShopContext'
import { openPolicy, type PolicyKind } from './policies'

/** Opens a policy page; `failed` stays true until the next try, so the screen can say it could not open. */
export function useOpenPolicy() {
  const { host } = useShop()
  const [failed, setFailed] = useState(false)
  const open = useCallback(
    async (kind: PolicyKind) => {
      setFailed(!(await openPolicy(host, kind)))
    },
    [host],
  )
  return { open, failed }
}
