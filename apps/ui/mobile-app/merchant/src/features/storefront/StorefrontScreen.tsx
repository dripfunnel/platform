import { useCallback } from 'react'
import { t } from '../../messages'
import { designClient, sessionClient } from '../../session'
import { useLoad } from '../common/useLoad'
import { loadStateOf } from '../orders/loadState'
import { useRefreshOnReturn } from '../settings/useRefreshOnReturn'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { loadPage } from './loadPage'
import { StorefrontView } from './StorefrontView'

// More › Storefront (FIRST-RELEASE (store) §14; `sfApp`): the live shop, one prompt that makes a draft to preview, discard or publish, the recent versions, and a way
// to the web portal for templates and the full designer. The seat is read first; a Manager looks only and the API decides every call again.
export function StorefrontScreen() {
  const client = sessionClient()
  const { state, online } = useShell()
  const readOnly = state?.readOnly === true
  const page = useLoad(() => loadPage(client, readOnly), [client, readOnly])
  const { set } = page
  const label = t('more.storefront')

  // A change that fails to read again leaves what is shown as it was.
  const refresh = useCallback(async () => {
    try {
      set(await loadPage(client, readOnly))
    } catch {
      return
    }
  }, [client, readOnly, set])
  useRefreshOnReturn(refresh)

  if (page.state.status === 'error') {
    return (
      <ShellScreen label={label} state={loadStateOf(page.state.error, online)} onRetry={page.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (page.state.status === 'loading') {
    return (
      <ShellScreen label={label}>
        <Skeleton />
      </ShellScreen>
    )
  }
  const { access, data } = page.state.data
  if (data === null) {
    return (
      <ShellScreen label={label} state="denied">
        {null}
      </ShellScreen>
    )
  }
  return (
    <ShellScreen label={label}>
      <StorefrontView client={client} designClient={designClient()} access={access} data={data} refresh={refresh} />
    </ShellScreen>
  )
}
