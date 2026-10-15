import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { Notice } from '../common/Notice'
import { stateOfError, useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { settingsAccess } from './access'

export type TabReads<T> = { data: T; canEdit: boolean; client: ApiClient }

type Props<T> = { label: string; load: (client: ApiClient) => Promise<T>; children: (reads: TabReads<T>) => ReactNode }

// What every Settings tab shares: the Owner-only gate (nothing is read for anyone else), the tab's reads, and the designed states.
export function TabFrame<T>({ label, load, children }: Props<T>) {
  const client = sessionClient()
  const { seat, state } = useShell()
  const { allowed, canEdit } = settingsAccess(seat, state?.readOnly === true)
  const loaded = useLoad(() => (allowed ? load(client) : new Promise<T>(() => undefined)), [client, allowed])
  const failure = loaded.state.status === 'error' ? loaded.state.error : null
  return (
    <ShellScreen label={label} onRetry={loaded.reload} {...(!allowed ? { state: 'denied' as const } : failure !== null ? { state: stateOfError(failure) } : {})}>
      {loaded.state.status === 'ready' ? (
        <View style={styles.content}>
          {!canEdit ? <Notice text={t('settings.common.readOnly')} /> : null}
          {children({ data: loaded.state.data, canEdit, client })}
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
