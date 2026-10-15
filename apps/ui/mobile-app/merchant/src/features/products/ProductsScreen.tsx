import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { loadAccess, type ProductCounts } from '../../api/products'
import { sessionClient } from '../../session'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Skeleton } from '../states/StateView'
import { ShellScreen } from '../states/ShellScreen'
import { useShell } from '../shell/ShellData'
import { canAddProduct } from './access'
import { ProductCard } from './ProductCard'
import { ProductsEmpty, type EmptyKind } from './ProductsEmpty'
import { ProductsFilters } from './ProductsFilters'
import { newProductHref, productHref } from './routes'
import { stateOfError, useLoad } from '../common/useLoad'
import { useProductList } from './useProductList'
import { useReview } from './useReview'

const summaryOf = (counts: ProductCounts, supplier: boolean): string => {
  const products = tCount('products.summary.products', counts.all)
  if (supplier) return t('products.summary.supplier', { products, waiting: formatNumber(counts.pending, locale), sentBack: formatNumber(counts.sentBack, locale) })
  const fromSuppliers = counts.fromSuppliers > 0 ? t('products.summary.fromSuppliers', { count: formatNumber(counts.fromSuppliers, locale) }) : ''
  return t('products.summary.merchant', { products, fromSuppliers, outOfStock: t('products.summary.outOfStock', { count: formatNumber(counts.outOfStock, locale) }) })
}

// Catalogue › Products, and a supplier's Products tab (FIRST-RELEASE.md §11, §17; CatList at phone width): the API's list as
// stacked cards, with search, sort, filters and Show more. What each seat sees is the API's to say, not narrowed here.
export function ProductsScreen() {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const { seat, state, refresh } = useShell()
  const client = sessionClient()
  const access = useLoad(() => loadAccess(client), [client])
  const list = useProductList(client)
  const review = useReview(client, () => {
    list.reload()
    refresh()
  })

  const failure = access.state.status === 'error' ? access.state.error : list.status === 'error' ? list.error : null
  if (failure !== null) {
    return (
      <ShellScreen
        label={t('tabs.products')}
        state={stateOfError(failure)}
        onRetry={() => {
          access.reload()
          list.reload()
        }}
      >
        {null}
      </ShellScreen>
    )
  }

  const permissions = access.state.status === 'ready' ? access.state.data : null
  const supplier = permissions?.supplier ?? seat?.side === 'supplier'
  const readOnly = state?.readOnly === true
  const canAdd = permissions !== null && canAddProduct(permissions, readOnly)
  const canApprove = permissions !== null && !permissions.supplier && permissions.permissions.includes('approve') && !readOnly
  const viewOnly = permissions !== null && !supplier && !permissions.permissions.includes('catalog.write')
  const counts = list.counts
  const open = (id: string) => router.push(productHref(seat, id) as never)
  const add = () => router.push(newProductHref(seat) as never)

  const clearAll = () => {
    list.setSearch('')
    list.setFilter('all')
  }

  const title = supplier ? t('products.titleSupplier') : viewOnly ? t('products.titleViewOnly') : t('products.title')
  const searching = list.query.search !== '' || list.query.filter !== 'all'
  const empty: EmptyKind | null = list.status !== 'ready' || list.rows.length > 0 ? null : searching ? 'noResults' : supplier ? 'supplierFirst' : 'first'

  return (
    <View style={styles.root}>
      <ShellScreen label={t('tabs.products')}>
        <View style={styles.content}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
              {title}
            </Text>
            {counts ? <Text style={[styles.summary, { color: colors.muted }]}>{summaryOf(counts, supplier)}</Text> : null}
          </View>

          {canApprove && counts && counts.pending > 0 && list.query.filter !== 'pending' ? (
            <View style={[styles.banner, { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder, borderRadius: radii.button }]}>
              <Text style={[styles.bannerText, { color: colors.warning }]}>
                <Text style={styles.bannerBold}>{tCount('products.banner.waiting', counts.pending)}</Text> {t('products.banner.waitingBody')}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => list.setFilter('pending')} style={[styles.bannerButton, { borderColor: colors.warningBorder, backgroundColor: colors.surface }]}>
                <Text style={[styles.bannerButtonText, { color: colors.warning }]}>{t('products.banner.waitingCta')}</Text>
              </Pressable>
            </View>
          ) : null}

          <ProductsFilters search={list.search} onSearch={list.setSearch} filter={list.query.filter} onFilter={list.setFilter} sort={list.query.sort} onSort={list.setSort} counts={counts} />

          {list.status === 'loading' ? <Skeleton /> : null}
          {empty ? <ProductsEmpty kind={empty} search={list.query.search} onAdd={canAdd ? add : null} onClear={clearAll} /> : null}
          {list.status === 'ready'
            ? list.rows.map((row) => (
                <ProductCard
                  key={row.id}
                  row={row}
                  onOpen={() => open(row.id)}
                  {...(canApprove ? { onApprove: () => void review.approve({ id: row.id, name: row.name, supplier: row.supplier?.name ?? null }), onSendBack: () => review.sendBack({ id: row.id, name: row.name, supplier: row.supplier?.name ?? null }) } : {})}
                />
              ))
            : null}
          {list.hasMore && list.status === 'ready' ? (
            list.loadingMore ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('products.showMore')} onPress={list.showMore} />
          ) : null}
        </View>
      </ShellScreen>
      {canAdd && list.status === 'ready' && list.rows.length > 0 ? (
        <Pressable accessibilityRole="button" onPress={add} style={[styles.fab, { backgroundColor: colors.brand }]}>
          <Text style={[styles.fabText, { color: colors.brandContrast }]}>{t('products.addFab')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 96 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  summary: { fontSize: 14 },
  banner: { padding: 12, gap: 10, borderWidth: 1 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  bannerBold: { fontWeight: '700' },
  bannerButton: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  bannerButtonText: { fontSize: 13, fontWeight: '700' },
  fab: { position: 'absolute', right: 16, bottom: 16, height: 54, paddingHorizontal: 22, borderRadius: 27, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { fontSize: 15, fontWeight: '800' },
})
