import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { loadStockHistory, type StockMovement } from '../../../api/inventory'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, t, tryT } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'

type Props = { client: ApiClient; productId: string; /** A version's name by id, for the line under each movement. */ nameOf: (versionId: string) => string }

const reasonText = (reason: string): string => tryT(`products.stock.reasons.${reason}`) ?? reason

const deltaText = (delta: number): string => (delta > 0 ? t('products.stock.deltaUp', { count: delta }) : t('products.stock.deltaDown', { count: Math.abs(delta) }))

// Every change to the product's stock, newest first (CATALOG-DESIGN.md G4): by hand, by orders, by suppliers and by imports,
// each with its reason, who, where and what the count became. Older ones load a page at a time.
export function StockHistory({ client, productId, nameOf }: Props) {
  const { colors, radii } = useTheme()
  const [rows, setRows] = useState<StockMovement[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (after: string | null) => {
      setBusy(true)
      try {
        const page = await loadStockHistory(client, productId, after)
        setRows((current) => (after === null ? page.rows : [...(current ?? []), ...page.rows]))
        setNext(page.next)
        setFailed(null)
      } catch (error) {
        setFailed(errorMessage(error, 'products'))
      } finally {
        setBusy(false)
      }
    },
    [client, productId],
  )

  useEffect(() => {
    void load(null)
  }, [load])

  return (
    <View style={[styles.box, { borderColor: colors.border, borderRadius: radii.button }]}>
      {rows === null && !failed ? <ActivityIndicator color={colors.muted} style={styles.pad} /> : null}
      {rows?.length === 0 ? <Text style={[styles.pad, { color: colors.muted }]}>{t('products.stock.historyNone')}</Text> : null}
      {rows?.map((row) => (
        <View key={row.id} style={[styles.row, { borderColor: colors.border }]}>
          <Text style={[styles.delta, { color: row.delta > 0 ? colors.success : row.delta < 0 ? colors.danger : colors.muted }]}>{deltaText(row.delta)}</Text>
          <View style={styles.text}>
            <Text style={[styles.reason, { color: colors.text }]}>{reasonText(row.reason)}</Text>
            <Text style={[styles.sub, { color: colors.muted }]}>
              {[nameOf(row.versionId), row.warehouseName, row.actorName ? t('products.stock.by', { name: row.actorName }) : t('products.stock.bySystem'), t('products.stock.now', { count: row.resultingQuantity })].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={[styles.when, { color: colors.muted }]}>{formatDateTime(row.occurredAt, locale, 'UTC')}</Text>
        </View>
      ))}
      {failed ? (
        <View style={styles.pad}>
          <Text style={{ color: colors.danger, fontSize: 13 }}>{failed}</Text>
          <Button kind="secondary" label={t('common.tryAgain')} onPress={() => void load(rows ? next : null)} />
        </View>
      ) : null}
      {next ? (
        <View style={styles.pad}>
          <Button kind="secondary" label={t('products.stock.historyMore')} onPress={() => void load(next)} busy={busy} />
        </View>
      ) : null}
      <Text style={[styles.note, { color: colors.muted, backgroundColor: colors.page }]}>{t('products.stock.historyNote')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, overflow: 'hidden' },
  pad: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', gap: 10, padding: 12, borderBottomWidth: 1, alignItems: 'flex-start' },
  delta: { width: 48, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  text: { flex: 1, gap: 2 },
  reason: { fontSize: 14 },
  sub: { fontSize: 12 },
  when: { fontSize: 11, maxWidth: 100, textAlign: 'right' },
  note: { fontSize: 12, padding: 10 },
})
