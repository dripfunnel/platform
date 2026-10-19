import { useCallback, useRef } from 'react'
import { loadCart } from '../../api/carts'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { stateOfError, useLoad } from '../common/useLoad'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import type { CartsAccess } from './access'
import { CartView } from './CartView'
import { useCartFacts } from './useCartFacts'

type Props = { client: ApiClient; id: string; access: CartsAccess }

// Reads one cart; one that isn't here (or isn't this store's) is the shell's 404. After an action it reads again without the skeleton, and a failed
// read leaves what is shown.
export function CartPage({ client, id, access }: Props) {
  const loaded = useLoad(() => loadCart(client, id), [client, id])
  const facts = useCartFacts(client)
  const { set } = loaded
  const { reload: reloadFacts } = facts
  const latest = useRef(() => loadCart(client, id))
  latest.current = () => loadCart(client, id)
  const refresh = useCallback(async () => {
    try {
      set(await latest.current())
      reloadFacts()
    } catch {
      // The action has been said already; what is shown stays as it was.
    }
  }, [set, reloadFacts])

  const detail = loaded.state.status === 'ready' ? loaded.state.data : null
  return (
    <ShellScreen
      label={t('carts.detail.screen')}
      onRetry={loaded.reload}
      {...(loaded.state.status === 'error' ? { state: stateOfError(loaded.state.error) } : loaded.state.status === 'ready' && !detail ? { state: 'notFound' as const } : {})}
    >
      {detail ? <CartView client={client} detail={detail} access={access} facts={facts} refresh={refresh} /> : <Skeleton />}
    </ShellScreen>
  )
}
