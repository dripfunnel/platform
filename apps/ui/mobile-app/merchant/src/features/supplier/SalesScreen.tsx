import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { sessionClient } from '../../session'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { useLoad } from '../common/useLoad'
import { ListMessage } from '../orders/ListMessage'
import { loadStateOf } from '../orders/loadState'
import { OrderExportStatus } from '../orders/OrderExportStatus'
import { useOrderExport } from '../orders/useOrderExport'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { supplierAccessOf } from './access'
import { SaleCard } from './SaleCard'
import { useSales } from './useSales'

const everything = { filter: 'ALL', search: '' } as const

// Your sales (FIRST-RELEASE (store) §17; VendorViews "sales" at phone width): the supplier's own sold lines at the price the store charged, newest first, with no
// totals and no payouts. Asks the API only for a seat that holds `sales.read`, and tells every other seat it has no access.
export function SalesScreen() {
  const { colors } = useTheme()
  const { state, online, acting } = useShell()
  const client = sessionClient()
  const permissions = useLoad(() => loadAccess(client), [client])
  const access = permissions.state.status === 'ready' ? supplierAccessOf(permissions.state.data, state?.readOnly === true) : null
  const sales = useSales(client, access?.canSeeSales === true)
  const exported = useOrderExport(client, everything)

  const failure = permissions.state.status === 'error' ? permissions.state.error : sales.status === 'error' ? sales.error : null
  const retry = () => {
    permissions.reload()
    sales.reload()
  }
  if (failure !== null) {
    return (
      <ShellScreen label={t('supplier.sales.label')} state={loadStateOf(failure, online)} onRetry={retry}>
        {null}
      </ShellScreen>
    )
  }
  if (access !== null && !access.canSeeSales) {
    return (
      <ShellScreen label={t('supplier.sales.label')} state="denied">
        {null}
      </ShellScreen>
    )
  }

  const job = exported.job
  const isEmpty = sales.status === 'ready' && sales.rows.length === 0
  const supplier = sales.supplier ?? t('supplier.yourCompany')

  return (
    <ShellScreen label={t('supplier.sales.label')}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('more.sales')}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('supplier.sales.sub', { supplier, store: acting.storeName })}</Text>
        </View>

        {access?.canExport && sales.status === 'ready' && !isEmpty ? <Button kind="secondary" saves label={t('supplier.sales.export')} busy={exported.busy} onPress={() => void exported.start()} /> : null}
        {exported.error !== null ? <Notice kind="error" text={errorMessage(exported.error, 'orders')} /> : null}
        {job ? <OrderExportStatus job={job} onShare={() => void exported.share(job)} /> : null}

        <Notice text={t('supplier.sales.note')} />

        {sales.status === 'loading' || access === null ? <Skeleton /> : null}
        {isEmpty ? <ListMessage title={t('supplier.sales.empty.title')} body={t('supplier.sales.empty.body')} /> : null}
        {sales.status === 'ready' ? sales.rows.map((sale) => <SaleCard key={sale.lineId} sale={sale} />) : null}
        {sales.hasMore && sales.status === 'ready' ? sales.loadingMore ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('orders.showMore')} onPress={sales.showMore} /> : null}
      </View>
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 14, lineHeight: 20 },
})
