import type { ReactNode } from 'react'
import { loadAccess } from '../../api/products'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { sessionClient } from '../../session'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { cartsAccessOf, type CartsAccess } from './access'

type Props = { label: string; children: (access: CartsAccess, client: ApiClient) => ReactNode }

// What every Carts screen shares: the seat's permissions are read first, and a seat without `carts.read` (every supplier) is access
// denied before a cart is asked for. The server refuses it again.
export function CartsGate({ label, children }: Props) {
  const client = sessionClient()
  const { state } = useShell()
  const permissions = useLoad(() => loadAccess(client), [client])
  if (permissions.state.status === 'ready') {
    const access = cartsAccessOf(permissions.state.data, state?.readOnly === true)
    if (access.canRead) return <>{children(access, client)}</>
  }
  return (
    <ShellScreen
      label={label}
      onRetry={permissions.reload}
      {...(permissions.state.status === 'error' ? { state: stateOfError(permissions.state.error) } : permissions.state.status === 'ready' ? { state: 'denied' as const } : {})}
    >
      <Skeleton />
    </ShellScreen>
  )
}
