import type { ReactNode } from 'react'
import { loadAccess } from '../../api/products'
import type { ApiClient } from '../../graphql'
import { sessionClient } from '../../session'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { customersAccessOf, type CustomersAccess } from './access'

type Props = { label: string; children: (access: CustomersAccess, client: ApiClient) => ReactNode }

// What every Customers screen shares: the seat's permissions are read first, and a seat without `customers.read` (every supplier) is
// access denied before a customer is asked for. The server refuses it again.
export function CustomersGate({ label, children }: Props) {
  const client = sessionClient()
  const { state } = useShell()
  const permissions = useLoad(() => loadAccess(client), [client])
  if (permissions.state.status === 'ready') {
    const access = customersAccessOf(permissions.state.data, state?.readOnly === true)
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
