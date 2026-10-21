import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { loadOrders, type OrderFilter } from '../../api/orders'
import { loadStoreTimeZone } from '../../api/storeInfo'
import { loadAccess } from '../../api/products'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { useLoad } from '../common/useLoad'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { ordersAccessOf } from './access'
import { ListMessage } from './ListMessage'
import { loadStateOf } from './loadState'
import { OrderCard } from './OrderCard'
import { OrderExportStatus } from './OrderExportStatus'
import { OrderFilters } from './OrderFilters'
import { orderHref } from './routes'
import { useOrderExport } from './useOrderExport'
import { useOrderList } from './useOrderList'

type Props = { initialFilter?: OrderFilter }

// The Orders tab (FIRST-RELEASE.md §6; PortalOrders at phone width): the API's list as stacked cards, with search, status chips, Show more and Export.
// What each seat sees and may do is the API's to say; the screen only hides what a seat can't use.
export function OrdersScreen({ initialFilter = 'ALL' }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const { state, online } = useShell()
  const client = sessionClient()
  const permissions = useLoad(() => loadAccess(client), [client])
  const access = permissions.state.status === 'ready' ? ordersAccessOf(permissions.state.data, state?.readOnly === true) : null
  const zone = useLoad(() => loadStoreTimeZone(client).then((known) => known ?? 'UTC', () => 'UTC'), [client])
  const list = useOrderList(client, access?.canRead === true, { filter: initialFilter }, loadOrders)
  const exported = useOrderExport(client, list.query)

  const failure = permissions.state.status === 'error' ? permissions.state.error : list.status === 'error' ? list.error : null
  const retry = () => {
    permissions.reload()
    list.reload()
  }
  if (failure !== null) {
    return (
      <ShellScreen label={t('tabs.orders')} state={loadStateOf(failure, online)} onRetry={retry}>
        {null}
      </ShellScreen>
    )
  }
  if (access !== null && !access.canRead) {
    return (
      <ShellScreen label={t('tabs.orders')} state="denied">
        {null}
      </ShellScreen>
    )
  }

  const counts = list.counts
  const job = exported.job
  const searching = list.query.search !== '' || list.query.filter !== 'ALL'
  const isEmpty = list.status === 'ready' && counts !== null && counts.all === 0 && !searching
  const timeZone = zone.state.status === 'ready' ? zone.state.data : 'UTC'
  const clearAll = () => {
    list.setSearch('')
    list.setFilter('ALL')
  }

  return (
    <ShellScreen label={t('tabs.orders')}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('orders.title')}
          </Text>
          {counts && !isEmpty ? <Text style={[styles.summary, { color: colors.muted }]}>{tCount('orders.summary', counts.all, { toShip: formatNumber(counts.toShip, locale) })}</Text> : null}
        </View>

        {access?.canExport && !isEmpty && list.status === 'ready' ? <Button kind="secondary" saves label={t('orders.export.button')} busy={exported.busy} onPress={() => void exported.start()} /> : null}
        {exported.error !== null ? <Notice kind="error" text={errorMessage(exported.error, 'orders')} /> : null}
        {job ? <OrderExportStatus job={job} onShare={() => void exported.share(job)} /> : null}

        {isEmpty ? null : <OrderFilters search={list.search} onSearch={list.setSearch} filter={list.query.filter} onFilter={list.setFilter} counts={counts} />}

        {list.status === 'loading' || access === null ? <Skeleton /> : null}
        {isEmpty ? <ListMessage title={t('orders.empty.title')} body={t('orders.empty.body')} /> : null}
        {list.status === 'ready' && !isEmpty && list.rows.length === 0 ? (
          <ListMessage title={list.query.search ? t('orders.noResults.search', { search: list.query.search }) : t('orders.noResults.filters')} body={t('orders.noResults.body')}>
            <Button kind="secondary" label={t('orders.noResults.clear')} onPress={clearAll} />
          </ListMessage>
        ) : null}
        {list.status === 'ready' ? list.rows.map((row) => <OrderCard key={row.id} row={row} timeZone={timeZone} onOpen={() => router.push(orderHref(row.id) as never)} />) : null}
        {list.hasMore && list.status === 'ready' ? list.loadingMore ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('orders.showMore')} onPress={list.showMore} /> : null}
      </View>
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  summary: { fontSize: 14 },
})
