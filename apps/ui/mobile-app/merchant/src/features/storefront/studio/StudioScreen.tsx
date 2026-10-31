import { useCallback } from 'react'
import { View } from 'react-native'
import { t } from '../../../messages'
import { designClient, sessionClient } from '../../../session'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useLoad } from '../../common/useLoad'
import { loadStateOf } from '../../orders/loadState'
import { useShell } from '../../shell/ShellData'
import { ShellScreen } from '../../states/ShellScreen'
import { Skeleton } from '../../states/StateView'
import { loadStudio } from './loadStudio'
import { StudioView } from './StudioView'

// The full designer's studio (More › Storefront › Open here anyway; FIRST-RELEASE (store) §14), the Owner's alone: the API refuses every other seat
// the studio, and a store view-only for payment takes no change.
export function StudioScreen() {
  const client = sessionClient()
  const { colors } = useTheme()
  const { state, online } = useShell()
  const readOnly = state?.readOnly === true
  const loaded = useLoad(() => loadStudio(client, readOnly), [client, readOnly])
  const { set } = loaded
  const label = t('storefront.studio.label')

  // A change that fails to read again leaves what is shown as it was.
  const refresh = useCallback(async () => {
    try {
      set(await loadStudio(client, readOnly))
    } catch {
      return
    }
  }, [client, readOnly, set])

  if (loaded.state.status === 'error') {
    return (
      <ShellScreen label={label} state={loadStateOf(loaded.state.error, online)} onRetry={loaded.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (loaded.state.status === 'loading') {
    return (
      <ShellScreen label={label}>
        <Skeleton />
      </ShellScreen>
    )
  }
  const { data } = loaded.state.data
  if (data === null) {
    return (
      <ShellScreen label={label} state="denied">
        {null}
      </ShellScreen>
    )
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <StudioView client={client} designClient={designClient()} data={data} refresh={refresh} />
    </View>
  )
}
