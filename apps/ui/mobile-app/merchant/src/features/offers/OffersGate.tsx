import type { ReactNode } from 'react'
import { loadAccess } from '../../api/products'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { sessionClient } from '../../session'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { offersAccessOf, type OffersAccess } from './access'

type Props = { label: string; children: (access: OffersAccess, client: ApiClient) => ReactNode }

// What every Offers screen shares: the seat's permissions are read first, and a seat without `offers.read` (every supplier) is access
// denied before an offer is asked for. The server refuses it again.
export function OffersGate({ label, children }: Props) {
  const client = sessionClient()
  const { state } = useShell()
  const permissions = useLoad(() => loadAccess(client), [client])
  if (permissions.state.status === 'ready') {
    const access = offersAccessOf(permissions.state.data, state?.readOnly === true)
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
