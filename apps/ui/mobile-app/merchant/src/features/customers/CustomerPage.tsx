import { useCallback, useRef } from 'react'
import { loadCustomer, loadCustomerGroups, loadStoreTimeZone } from '../../api/customers'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { stateOfError, useLoad } from '../common/useLoad'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import type { CustomersAccess } from './access'
import { CustomerView } from './CustomerView'

const loadAll = async (client: ApiClient, id: string) => {
  // The zone only names when dates happened; a seat that can't read it shows UTC, named.
  const [customer, groups, timeZone] = await Promise.all([loadCustomer(client, id), loadCustomerGroups(client), loadStoreTimeZone(client).catch(() => null)])
  return { customer, groups, timeZone: timeZone ?? 'UTC' }
}

type Props = { client: ApiClient; id: string; access: CustomersAccess }

// Reads one customer with the store's groups; one that isn't here is the shell's 404. After a write it reads again without the skeleton, so
// what is typed in the other cards stays; a failed read leaves what is shown.
export function CustomerPage({ client, id, access }: Props) {
  const loaded = useLoad(() => loadAll(client, id), [client, id])
  const { set } = loaded
  const latest = useRef(() => loadAll(client, id))
  latest.current = () => loadAll(client, id)
  const refresh = useCallback(async () => {
    try {
      set(await latest.current())
    } catch {
      // The write has been said already; what is shown stays as it was.
    }
  }, [set])

  const data = loaded.state.status === 'ready' ? loaded.state.data : null
  return (
    <ShellScreen
      label={t('customers.detail.screen')}
      onRetry={loaded.reload}
      {...(loaded.state.status === 'error' ? { state: stateOfError(loaded.state.error) } : data && !data.customer ? { state: 'notFound' as const } : {})}
    >
      {data?.customer ? <CustomerView client={client} customer={data.customer} groups={data.groups} timeZone={data.timeZone} access={access} refresh={refresh} /> : <Skeleton />}
    </ShellScreen>
  )
}
