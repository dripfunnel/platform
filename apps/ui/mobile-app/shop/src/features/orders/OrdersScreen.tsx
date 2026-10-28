import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { pluralForm } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { orderHistoryOperation, type OrderSummary } from '../../api/orders'
import { run } from '../../api/operation'
import { useShop } from '../../api/ShopContext'
import { locale, t } from '../../messages'
import { money } from '../catalogue/words'
import { errorKey } from '../common/errors'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'
import { useRefreshOnFocus } from '../common/useRefreshOnFocus'
import { StatusPill } from './StatusPill'
import { orderStatus } from './status'
import { orderDay, zoneOf } from './time'

const itemsText = (count: number): string => pluralForm(locale, { one: t('orders.items.one', { count }), other: t('orders.items.other', { count }) }, count)

function Row({ order, zone, onOpen }: { order: OrderSummary; zone: string; onOpen: () => void }) {
  const { colors, radii } = useTheme()
  const status = orderStatus(order)
  const when = order.placedAt ? orderDay(order.placedAt, zone) : null
  const line = when ? t('orders.row', { date: when, items: itemsText(order.itemCount) }) : itemsText(order.itemCount)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[t('orders.order', { number: order.number }), line, status.label, order.total ? money(order.total) : null].filter(Boolean).join(', ')}
      onPress={onOpen}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
    >
      <View style={styles.rowText}>
        <Text style={{ color: colors.heading, fontSize: 15, fontWeight: '800' }}>{t('orders.order', { number: order.number })}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{line}</Text>
      </View>
      <View style={styles.rowEnd}>
        <StatusPill status={status} />
        {order.total ? <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{money(order.total)}</Text> : null}
      </View>
    </Pressable>
  )
}

/** The signed-in customer's orders, newest first. A guest has no list (the order is opened from its confirmation or a push). */
export function OrdersScreen() {
  const router = useRouter()
  const { client, signedIn } = useShop()
  const { colors } = useTheme()
  const { state, retry, refresh } = useOperation(signedIn ? orderHistoryOperation(null) : null)
  useRefreshOnFocus(refresh)
  const action = useAction()
  const [extra, setExtra] = useState<OrderSummary[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)

  // A fresh first page replaces what "show more" added.
  useEffect(() => {
    setExtra([])
    setCursor(undefined)
  }, [state])

  const showMore = async (after: string) => {
    const done = await action.run(() => run(client, orderHistoryOperation(after)))
    if (!done) return
    setExtra((all) => [...all, ...done.value.items])
    setCursor(done.value.next)
  }

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/account'))
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('orders.title')} onBack={leave} />
      <ScrollView contentContainerStyle={styles.body}>
        {!signedIn ? (
          <StateMessage title={t('orders.guest.title')} body={t('orders.guest.body')} actionLabel={t('orders.guest.action')} onAction={() => router.push('/sign-in')} />
        ) : (
          <Resource state={state} onRetry={retry} skeleton="list">
            {(first) => {
              const next = cursor === undefined ? first.next : cursor
              const zone = zoneOf(first.timeZone)
              const all = [...first.items, ...extra]
              if (all.length === 0) return <StateMessage title={t('orders.empty.title')} body={t('orders.empty.body')} actionLabel={t('orders.empty.action')} onAction={() => router.push('/home')} />
              return (
                <>
                  {all.map((order) => (
                    <Row key={order.id} order={order} zone={zone} onOpen={() => router.push({ pathname: '/orders/[id]', params: { id: order.id } })} />
                  ))}
                  {action.error ? (
                    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
                      {t(errorKey(action.error))}
                    </Text>
                  ) : null}
                  {next ? <Button kind="secondary" label={t('orders.more')} busy={action.busy} onPress={() => void showMore(next)} /> : null}
                </>
              )
            }}
          </Resource>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 10, padding: 16, paddingBottom: 40 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderWidth: 1 },
  rowText: { flex: 1, gap: 3 },
  rowEnd: { alignItems: 'flex-end', gap: 6 },
})
