import { StyleSheet, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { loadStoreTimeZone } from '../../api/storeInfo'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { Notice } from '../common/Notice'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { activityAccessOf } from './access'
import { ActivityView } from './ActivityView'

// Store activity (StoreActivity; FIRST-RELEASE (store) §15): the Manager's way to the log, since Settings is the Owner's. Anyone without
// `activity.read` is told so before anything is asked for; the Manager reads the same log as the Owner, without the export.
export function ActivityScreen() {
  const client = sessionClient()
  const { state } = useShell()
  const loaded = useLoad(async () => {
    const [acting, timeZone] = await Promise.all([loadAccess(client), loadStoreTimeZone(client).catch(() => null)])
    return { access: activityAccessOf(acting), timeZone: timeZone ?? 'UTC' }
  }, [client])

  const ready = loaded.state.status === 'ready' ? loaded.state.data : null
  return (
    <ShellScreen
      label={t('activity.label')}
      onRetry={loaded.reload}
      {...(loaded.state.status === 'error' ? { state: stateOfError(loaded.state.error) } : ready && !ready.access.canRead ? { state: 'denied' as const } : {})}
    >
      {ready?.access.canRead ? (
        <View style={styles.content}>
          {state?.readOnly ? <Notice text={t('activity.readOnly')} /> : null}
          <ActivityView title={t('activity.managerTitle')} client={client} timeZone={ready.timeZone} canExport={ready.access.canExport} />
        </View>
      ) : (
        <Skeleton />
      )}
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
})
