import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { accountOperation } from '../../api/account'
import type { Cart, PlacedOrder } from '../../api/cart'
import { t } from '../../messages'
import { useCart } from '../cart/useCart'
import { errorKey } from '../common/errors'
import { Resource, ScreenHeader, Skeleton, StateMessage } from '../common/ui'
import { useOperation } from '../common/useOperation'
import { AddressStep } from './AddressStep'
import { Confirmation } from './Confirmation'
import { ContactStep } from './ContactStep'
import { DeliveryStep } from './DeliveryStep'
import { SummaryBar } from './OrderSummary'
import { PaymentStep } from './PaymentStep'
import { PayScreen } from './payments/PayScreen'
import { ReviewStep } from './ReviewStep'
import { refusalCode, returnFor, stepsFor, type Step } from './steps'

function Progress({ steps, step }: { steps: Step[]; step: Step }) {
  const { colors } = useTheme()
  const index = steps.indexOf(step)
  return (
    <View accessible accessibilityLabel={t('checkout.progress', { step: index + 1, count: steps.length, name: t(`checkout.steps.${step}`) })} style={styles.progress}>
      {steps.map((s, i) => (
        <View key={s} style={styles.segment}>
          <View style={[styles.bar, { backgroundColor: i <= index ? colors.brand : colors.skeleton }]} />
          <Text style={{ color: i === index ? colors.heading : colors.muted, fontSize: 12, fontWeight: i === index ? '800' : '500' }}>{t(`checkout.steps.${s}`)}</Text>
        </View>
      ))}
    </View>
  )
}

/** Checkout in the prototype's order, each step written to the API's cart; a refusal returns the shopper to the step that can fix it (steps.ts). */
export function CheckoutScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry, apply } = useCart()
  const account = useOperation(accountOperation())
  const [wanted, setWanted] = useState<Step>('contact')
  const [notice, setNotice] = useState<string | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ order: PlacedOrder; cart: Cart } | null>(null)
  // An order placed for a card or wallet payment, not yet paid: its sheet is open or the payment is being confirmed.
  const [paying, setPaying] = useState<{ order: PlacedOrder; cart: Cart } | null>(null)
  const [stopped, setStopped] = useState<string | null>(null)

  const cart = state.status === 'ready' ? state.data : null
  const steps = cart ? stepsFor(cart) : []
  const step = steps.includes(wanted) ? wanted : (steps[0] ?? 'contact')
  const index = steps.indexOf(step)

  const go = (to: Step) => {
    setNotice(null)
    setWanted(to)
  }
  const goBack = () => {
    const before = steps[index - 1]
    if (before) go(before)
    else if (router.canGoBack()) router.back()
    else router.replace('/cart')
  }
  const refused = (error: unknown) => {
    const to = returnFor(error)
    if (to === 'cart') setStopped(refusalCode(error))
    else if (to) {
      setNotice(refusalCode(error))
      setWanted(to)
    }
  }

  const renderFlow = (live: Cart) => {
    const read = account.state.status === 'ready' ? account.state.data : null
    const next = () => go(steps[index + 1] ?? step)
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Progress steps={steps} step={step} />
        {step === 'review' ? null : <SummaryBar cart={live} />}
        {notice ? (
          <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder }]}>
            <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '600' }}>{t(errorKey(notice))}</Text>
          </View>
        ) : null}
        {step === 'contact' ? account.state.status === 'loading' ? <Skeleton kind="list" /> : <ContactStep cart={live} account={read?.account ?? null} apply={apply} next={next} /> : null}
        {step === 'address' ? (
          <Resource state={account.state} onRetry={account.retry} skeleton="list">
            {(accountRead) => <AddressStep cart={live} read={accountRead} apply={apply} next={next} />}
          </Resource>
        ) : null}
        {step === 'delivery' ? <DeliveryStep cart={live} apply={apply} next={next} changeAddress={() => go('address')} /> : null}
        {step === 'payment' ? <PaymentStep cart={live} provider={provider} onProvider={setProvider} apply={apply} next={next} onRefused={refused} /> : null}
        {step === 'review' && provider ? <ReviewStep cart={live} provider={provider} onPlaced={(order) => (order.payment ? setPaying({ order, cart: live }) : setPlaced({ order, cart: live }))} onRefused={refused} /> : null}
      </ScrollView>
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('checkout.title')} {...(placed || paying ? {} : { onBack: goBack })} />
      {placed ? (
        <Confirmation order={placed.order} cart={placed.cart} onDone={() => router.replace('/home')} />
      ) : paying ? (
        <PayScreen
          order={paying.order}
          cart={paying.cart}
          onPaid={() => {
            setPlaced(paying)
            setPaying(null)
          }}
          onLeave={() => router.replace('/home')}
        />
      ) : stopped ? (
        <StateMessage title={t('states.error.title')} body={t(errorKey(stopped))} actionLabel={t('checkout.refused.toCart')} onAction={() => router.replace('/cart')} />
      ) : (
        <Resource state={state} onRetry={retry} skeleton="list">
          {(live) =>
            live && live.lines.length > 0 ? renderFlow(live) : <StateMessage title={t('checkout.empty.title')} body={t('checkout.empty.body')} actionLabel={t('checkout.empty.action')} onAction={() => router.replace('/cart')} />
          }
        </Resource>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 16, padding: 16, paddingBottom: 40 },
  progress: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, gap: 4 },
  bar: { height: 4, borderRadius: 2 },
  notice: { borderWidth: 1, borderRadius: 8, padding: 12 },
})
