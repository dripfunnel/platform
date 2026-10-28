import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { formatDateTime, formatMoney, formatNumber } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { fetchHistory, type HistoryPage, type PastDelivery } from '../../api/history'
import { locale, t } from '../../messages'
import { useSession } from '../../session/SessionContext'
import { Button, Refusal, Resource, StateMessage } from '../common/ui'
import { useLoad } from '../common/useLoad'

type Result = 'delivered' | 'notDelivered' | 'recalled'

const resultOf = (past: PastDelivery): Result => (past.state === 'delivered' ? 'delivered' : past.failedReason === 'recalled' ? 'recalled' : 'notDelivered')

function Count({ label, count }: { label: string; count: number }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.count, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={[styles.countNumber, { color: colors.heading }]}>{formatNumber(count, locale)}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{t('history.delivered')}</Text>
    </View>
  )
}

function Row({ past, first }: { past: PastDelivery; first: boolean }) {
  const { colors } = useTheme()
  const result = resultOf(past)
  const pill = result === 'delivered' ? [colors.successSurface, colors.success] : result === 'recalled' ? [colors.infoSurface, colors.info] : [colors.page, colors.muted]
  const at = past.deliveredAt ?? past.failedAt
  const paid = past.feeAmount !== null && past.currency !== null && /[1-9]/.test(past.feeAmount)
  return (
    <View style={[styles.row, { borderColor: colors.border, borderTopWidth: first ? 0 : 1 }]}>
      <View style={styles.between}>
        <Text style={{ color: colors.muted, fontSize: 13, flexShrink: 1 }}>{at ? formatDateTime(at, locale, Intl.DateTimeFormat().resolvedOptions().timeZone) : ''}</Text>
        <Text style={[styles.pill, { backgroundColor: pill[0], color: pill[1] }]}>{t(`history.result.${result}`)}</Text>
      </View>
      <Text style={{ color: colors.heading, fontSize: 15, fontWeight: '600' }}>{t('history.route', { warehouse: past.warehouse?.name ?? t('home.warehouse'), area: past.area ?? '' })}</Text>
      <Text style={{ color: colors.textStrong, fontSize: 13 }}>
        {paid && past.feeAmount !== null && past.currency !== null ? t('history.fee', { amount: formatMoney({ amount: past.feeAmount, currency: past.currency }, locale) }) : t('history.freeDelivery')}
      </Text>
    </View>
  )
}

// What the rider has done: today's and this week's counts, then past deliveries newest first (docs/mobile-app/delivery/FIRST-RELEASE.md §2).
export function HistoryScreen() {
  const { colors, radii } = useTheme()
  const { client } = useSession()
  const { state, reload } = useLoad(() => fetchHistory(client))
  const [more, setMore] = useState<{ deliveries: PastDelivery[]; cursor: string | null; hasMore: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)

  // Coming back to the tab loads again, so a delivery just finished is counted; the first focus is the first load.
  const seen = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (seen.current) reload()
      seen.current = true
    }, [reload]),
  )
  useEffect(() => {
    if (state.status === 'ready') setMore(null)
  }, [state])

  const showMore = async (first: HistoryPage) => {
    const cursor = more ? more.cursor : first.endCursor
    setMoreFailed(false)
    setLoadingMore(true)
    try {
      const page = await fetchHistory(client, cursor)
      setMore({ deliveries: [...(more?.deliveries ?? []), ...page.deliveries], cursor: page.endCursor, hasMore: page.hasNextPage })
    } catch {
      setMoreFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={styles.body}>
      <Resource state={state} onRetry={reload}>
        {(first) => {
          const past = [...first.deliveries, ...(more?.deliveries ?? [])]
          const hasMore = more ? more.hasMore : first.hasNextPage
          return (
            <>
              <View style={styles.counts}>
                <Count label={t('history.today')} count={first.deliveredToday} />
                <Count label={t('history.thisWeek')} count={first.deliveredThisWeek} />
              </View>
              {past.length === 0 ? (
                <StateMessage title={t('history.emptyTitle')} body={t('history.emptyBody')} />
              ) : (
                <View style={styles.group}>
                  <Text accessibilityRole="header" style={[styles.heading, { color: colors.muted }]}>
                    {t('history.past')}
                  </Text>
                  <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
                    {past.map((one, index) => (
                      <Row key={one.id} past={one} first={index === 0} />
                    ))}
                  </View>
                  <Refusal message={moreFailed ? t('history.showMoreFailed') : null} />
                  {hasMore ? <Button kind="secondary" label={t('history.showMore')} busy={loadingMore} onPress={() => void showMore(first)} /> : null}
                </View>
              )}
            </>
          )
        }}
      </Resource>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { gap: 16, padding: 16, paddingTop: 56 },
  counts: { flexDirection: 'row', gap: 10 },
  count: { flex: 1, borderWidth: 1, padding: 14 },
  countNumber: { fontSize: 32, fontWeight: '800', lineHeight: 36 },
  group: { gap: 10 },
  heading: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', paddingLeft: 4 },
  list: { borderWidth: 1, overflow: 'hidden' },
  row: { paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pill: { overflow: 'hidden', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 2, fontSize: 12, fontWeight: '600' },
})
