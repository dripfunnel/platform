import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { OrderFilter } from '../../api/orders'
import { loadAccess } from '../../api/products'
import { loadSupplierOrders } from '../../api/supplier'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { useLoad } from '../common/useLoad'
import { useReloadOnFocus } from '../collections/useReloadOnFocus'
import { ListMessage } from '../orders/ListMessage'
import { loadStateOf } from '../orders/loadState'
import { OrderFilters } from '../orders/OrderFilters'
import { useOrderList } from '../orders/useOrderList'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { supplierAccessOf } from './access'
import { toShipHref } from './routes'
import { SupplierOrderCard } from './SupplierOrderCard'

// A supplier's chips have no money to filter by.
const chips: readonly OrderFilter[] = ['ALL', 'TO_SHIP', 'PARTLY_SHIPPED', 'SHIPPED']

type Props = { initialFilter?: OrderFilter }

// The To ship tab (FIRST-RELEASE (store) §17; PortalOrders as a supplier, at phone width): the orders with this supplier's items in them, as the API lists
// them, each with where its items go by the mode it was placed under. Nothing of the merchant's or another supplier's is asked for or drawn.
export function ToShipScreen({ initialFilter = 'ALL' }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const { state, online, acting } = useShell()
  const client = sessionClient()
  const permissions = useLoad(() => loadAccess(client), [client])
  const access = permissions.state.status === 'ready' ? supplierAccessOf(permissions.state.data, state?.readOnly === true) : null
  const list = useOrderList(client, access?.canRead === true, { filter: initialFilter }, loadSupplierOrders)

  // An order marked sent or shipped on its own screen shows its new status here when the person comes back.
  useReloadOnFocus(list.reload)

  const failure = permissions.state.status === 'error' ? permissions.state.error : list.status === 'error' ? list.error : null
  const retry = () => {
    permissions.reload()
    list.reload()
  }
  if (failure !== null) {
    return (
      <ShellScreen label={t('tabs.toShip')} state={loadStateOf(failure, online)} onRetry={retry}>
        {null}
      </ShellScreen>
    )
  }
  if (access !== null && !access.canRead) {
    return (
      <ShellScreen label={t('tabs.toShip')} state="denied">
        {null}
      </ShellScreen>
    )
  }

  const counts = list.counts
  const searching = list.query.search !== '' || list.query.filter !== 'ALL'
  const isEmpty = list.status === 'ready' && counts !== null && counts.all === 0 && !searching
  const clearAll = () => {
    list.setSearch('')
    list.setFilter('ALL')
  }

  return (
    <ShellScreen label={t('tabs.toShip')}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('supplier.toShip.title')}
          </Text>
          <Text style={[styles.summary, { color: colors.muted }]}>{counts && !isEmpty ? t('supplier.toShip.summary', { count: formatNumber(counts.toShip, locale) }) : t('supplier.toShip.sub')}</Text>
        </View>

        {isEmpty ? null : <OrderFilters search={list.search} onSearch={list.setSearch} filter={list.query.filter} onFilter={list.setFilter} counts={counts} chips={chips} placeholder={t('supplier.toShip.searchPlaceholder')} />}

        {list.status === 'loading' || access === null ? <Skeleton /> : null}
        {isEmpty ? <ListMessage title={t('supplier.toShip.empty.title')} body={t('supplier.toShip.empty.body')} /> : null}
        {list.status === 'ready' && !isEmpty && list.rows.length === 0 ? (
          <ListMessage title={list.query.search ? t('orders.noResults.search', { search: list.query.search }) : t('orders.noResults.filters')} body={t('orders.noResults.body')}>
            <Button kind="secondary" label={t('orders.noResults.clear')} onPress={clearAll} />
          </ListMessage>
        ) : null}
        {list.status === 'ready' ? list.rows.map((row) => <SupplierOrderCard key={row.id} row={row} store={acting.storeName} onOpen={() => router.push(toShipHref(row.id) as never)} />) : null}
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
