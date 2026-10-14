import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { sessionClient } from '../../session'
import { t } from '../../messages'
import { useLoad, stateOfError } from '../products/useLoad'
import { useShell } from '../shell/ShellData'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { collectionsAccess } from './access'
import { AreaTabs, type AreaTab } from './AreaTabs'
import { loadAreaData } from './areaData'
import { CollectionsList } from './CollectionsList'
import { FiltersTab } from './FiltersTab'
import { MenusTab } from './MenusTab'
import { collectionHref, newCollectionHref } from './routes'
import { SizeChartsTab } from './SizeChartsTab'
import { useReloadOnFocus } from './useReloadOnFocus'

// Catalogue › Collections (FIRST-RELEASE.md §12; CatCollections at phone width): its four parts under a tab bar. The collections and
// the filters are read once here, as rules, the menu and the editors all draw on them; the menu and the charts read their own.
export function CollectionsArea() {
  const router = useRouter()
  const client = sessionClient()
  const { state } = useShell()
  const [tab, setTab] = useState<AreaTab>('collections')
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
    if (tab === 'filters') return <FiltersTab filters={loaded.filters} collections={loaded.collections} canEdit={access.canEdit} onChanged={data.reload} />
    if (tab === 'menus') return <MenusTab collections={loaded.collections} canEdit={access.canEdit} />
    if (tab === 'sizeCharts') return <SizeChartsTab facts={loaded.facts} canEdit={access.canEdit} />
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
      <AreaTabs value={tab} onChange={setTab} />
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
