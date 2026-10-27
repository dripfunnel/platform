import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { fetchStoreCountry } from '../../../api/store'
import { payOrder, readPayment, type Cart, type PaymentStart, type PlacedOrder } from '../../../api/cart'
import { useShop } from '../../../api/ShopContext'
import { useBrand } from '../../../brand/BrandContext'
import { t } from '../../../messages'
import { money } from '../../catalogue/words'
import { errorKey } from '../../common/errors'
import { Button } from '../../common/ui'
import { useAction } from '../../common/useAction'
import { paymentBuild } from './env'
import type { Outcome, StopReason } from './outcome'
import { pay } from './pay'
import { appPaymentInput } from './start'
import { realClock, settle, type Clock } from './settle'

type Phase = { kind: 'opening' } | { kind: 'confirming' } | { kind: 'stopped'; reason: StopReason } | { kind: 'pending' }

type Props = { order: PlacedOrder; cart: Cart; onPaid: () => void; onLeave: () => void; /** The poll's clock, which a test moves by hand. */ clock?: Clock }

/**
 * An order placed for a card or wallet payment: Stripe's sheet or PayPal's approval page opens, and when it closes the order is read until
 * the provider's webhook has marked it paid. A closed or failed sheet comes back here with its reason and a way to try again on the same
 * order (`payOrder`: a new attempt, never a second order); an unconfirmed one says so and does not offer to pay again.
 */
export function PayScreen({ order, cart, onPaid, onLeave, clock = realClock }: Props) {
  const { client } = useShop()
  const { brand } = useBrand()
  const { colors } = useTheme()
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' })
  const started = useRef(false)
  const method = t(order.provider === 'paypal' ? 'checkout.pay.method.paypal' : 'checkout.pay.method.stripe')

  const read = useCallback(() => readPayment(client, order.orderId), [client, order.orderId])
  const finish = useCallback(
    (outcome: Outcome) => {
      if (outcome.kind === 'paid') onPaid()
      else setPhase(outcome.kind === 'pending' ? { kind: 'pending' } : { kind: 'stopped', reason: outcome.reason })
    },
    [onPaid],
  )

  const run = useCallback(
    async (start: PaymentStart) => {
      setPhase({ kind: 'opening' })
      const build = paymentBuild()
      const country = await fetchStoreCountry(client).catch(() => null)
      finish(await pay(order.provider, start, { build, storeName: brand?.name ?? '', email: cart.email || null, country }, { read, clock, settling: () => setPhase({ kind: 'confirming' }) }))
    },
    [client, order.provider, brand?.name, cart.email, read, clock, finish],
  )

  // "Try again" is a new attempt for the same order; an order that got paid meanwhile is simply read as paid.
  const again = useAction((error) => {
    if (isApiError(error, 'ALREADY_PAID')) {
      void checkAgain()
      return true
    }
    return false
  })

  const retry = async () => {
    const input = appPaymentInput(order.provider)
    if (!input) return
    const done = await again.run(() => payOrder(client, order.orderId, input))
    if (done) await run(done.value)
  }

  const checkAgain = async () => {
    setPhase({ kind: 'confirming' })
    const settled = await settle(read, clock)
    finish(settled === 'paid' ? { kind: 'paid' } : settled === 'cancelled' ? { kind: 'stopped', reason: 'declined' } : { kind: 'pending' })
  }

  useEffect(() => {
    if (started.current || !order.payment) return
    started.current = true
    void run(order.payment)
  }, [order.payment, run])

  const waiting = phase.kind === 'opening' || phase.kind === 'confirming'
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {waiting ? (
        <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.waiting}>
          <ActivityIndicator color={colors.brand} />
          <Text style={{ color: colors.heading, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>{phase.kind === 'opening' ? t('checkout.pay.opening', { method }) : t('checkout.pay.confirming')}</Text>
          {phase.kind === 'confirming' ? <Text style={{ color: colors.textStrong, fontSize: 15, textAlign: 'center' }}>{t('checkout.pay.confirmingBody')}</Text> : null}
        </View>
      ) : null}
      {phase.kind === 'stopped' ? (
        <View accessibilityRole="alert" style={styles.stopped}>
          <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 20, fontWeight: '800' }}>
            {t('checkout.pay.stoppedTitle')}
          </Text>
          <Text style={{ color: colors.danger, fontSize: 15, fontWeight: '600' }}>{t(`checkout.pay.${phase.reason}`)}</Text>
          <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('checkout.pay.orderNote', { number: order.number })}</Text>
          {order.total ? <Text style={{ color: colors.text, fontSize: 15 }}>{money(order.total)}</Text> : null}
        </View>
      ) : null}
      {phase.kind === 'pending' ? (
        <View accessibilityRole="alert" style={styles.stopped}>
          <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 20, fontWeight: '800' }}>
            {t('checkout.pay.pendingTitle')}
          </Text>
          <Text style={{ color: colors.textStrong, fontSize: 15 }}>{t('checkout.pay.pendingBody')}</Text>
        </View>
      ) : null}
      {again.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(again.error))}
        </Text>
      ) : null}
      {phase.kind === 'stopped' ? (
        <>
          <Button label={t('checkout.pay.retry')} busy={again.busy} onPress={() => void retry()} />
          <Button kind="secondary" label={t('checkout.pay.leave')} onPress={onLeave} />
        </>
      ) : null}
      {phase.kind === 'pending' ? (
        <>
          <Button label={t('checkout.pay.checkAgain')} onPress={() => void checkAgain()} />
          <Button kind="secondary" label={t('checkout.pay.done')} onPress={onLeave} />
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { gap: 16, padding: 16, paddingBottom: 40 },
  waiting: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  stopped: { gap: 8 },
})
