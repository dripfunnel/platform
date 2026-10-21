import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { LinkButton } from '../../common/LinkButton'
import { SectionCard } from '../../common/SectionCard'
import { StockHistory } from './StockHistory'
import { StockInputs } from './StockInputs'
import { liveVersions, type Draft, type DraftVersion } from './draft'
import { onHandOf, reservedOf, type StockContext } from './stock'

type Props = {
  draft: Draft
  update: (change: (draft: Draft) => Draft) => void
  stock: StockContext
  client: ApiClient
  productId: string | null
  /** A product with no choices counts here; one with choices counts on each version. */
  simple: boolean
  onAdjust: (version: DraftVersion) => void
}

// Stock (CATALOG-DESIGN.md G1–G7): counts per location, what is reserved for orders, and every change in the history. A
// supplier reads and counts only its own locations; the API never answers with another's.
export function StockCard({ draft, update, stock, client, productId, simple, onAdjust }: Props) {
  const { colors } = useTheme()
  const [history, setHistory] = useState(false)
  const live = liveVersions(draft)
  const ids = live.map((version) => version.id)
  const home = stock.warehouses.find((warehouse) => warehouse.isDefault) ?? stock.warehouses[0]
  const reserved = reservedOf(stock, ids)
  const where = stock.warehouses.length > 1 ? tCount('products.stock.whereSplit', stock.warehouses.length) : home ? t('products.stock.where', { warehouse: home.name }) : null
  const nameOf = (versionId: string) => live.find((version) => version.id === versionId)?.choices.join(' / ') ?? ''
  const only = live[0]

  return (
    <SectionCard title={t('products.stock.title')} sub={where ?? undefined}>
      {simple && only ? (
        <>
          <Text style={[styles.help, { color: colors.muted }]}>{t('products.stock.help')}</Text>
          <StockInputs draft={draft} update={update} version={only} stock={stock} onAdjust={onAdjust} />
        </>
      ) : (
        <View style={styles.block}>
          <Text style={[styles.help, { color: colors.textStrong }]}>{tCount('products.stock.versionsTotal', live.length, { total: onHandOf(stock, ids) })}</Text>
          {reserved > 0 ? <Text style={[styles.help, { color: colors.muted }]}>{tCount('products.stock.reserved', reserved)}</Text> : null}
          <Text style={[styles.help, { color: colors.muted }]}>{t('products.stock.perVersion')}</Text>
        </View>
      )}
      {productId ? <LinkButton label={history ? t('products.stock.hideHistory') : t('products.stock.history')} onPress={() => setHistory(!history)} /> : null}
      {productId && history ? <StockHistory client={client} productId={productId} nameOf={nameOf} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  help: { fontSize: 13, lineHeight: 19 },
})
