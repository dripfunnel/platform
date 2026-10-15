import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { sessionClient } from '../../session'
import { t } from '../../messages'
import { useLoad, stateOfError } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { collectionsAccess } from './access'
import { loadAreaData } from './areaData'
import { CollectionsList } from './CollectionsList'
import { collectionHref, newCollectionHref } from './routes'
import { useReloadOnFocus } from './useReloadOnFocus'

// Catalogue › Collections (FIRST-RELEASE.md §12; CatCollections at phone width). The collections and the filters are read once, as
// the rule builder and the editors draw on them.
export function CollectionsArea() {
  const router = useRouter()
  const client = sessionClient()
  const { state } = useShell()
  const permissions = useLoad(() => loadAccess(client), [client])
  const data = useLoad(() => loadAreaData(client), [client])
  useReloadOnFocus(data.reload)

  const failure = permissions.state.status === 'error' ? permissions.state.error : data.state.status === 'error' ? data.state.error : null
  const access = permissions.state.status === 'ready' ? collectionsAccess(permissions.state.data, state?.readOnly === true) : null
  const retry = () => {
    permissions.reload()
    data.reload()
  }

  const body = () => {
    if (access === null || data.state.status !== 'ready') return <Skeleton />
    const loaded = data.state.data
    return (
      <CollectionsList
        collections={loaded.collections}
        filters={loaded.filters}
        canEdit={access.canEdit}
        seasonal={loaded.seasonal}
        currency={loaded.facts.currency}
        onOpen={(id) => router.push(collectionHref(id) as never)}
        onCreate={(name) => router.push(newCollectionHref(name) as never)}
      />
    )
  }

  return (
    <View style={styles.root}>
      <ShellScreen label={t('collections.screen')} onRetry={retry} {...(failure !== null ? { state: stateOfError(failure) } : access !== null && !access.canRead ? { state: 'denied' as const } : {})}>
        <View style={styles.content}>{body()}</View>
      </ShellScreen>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
})
