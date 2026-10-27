import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { placeOrder, type Cart, type DeliveryAddress, type PlacedOrder } from '../../api/cart'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { errorKey } from '../common/errors'
import { Button } from '../common/ui'
import { useAction } from '../common/useAction'
import { OrderSummary } from './OrderSummary'
import { sendBack } from './steps'
import { optionName, optionPrice, paymentName } from './words'

type Props = { cart: Cart; provider: string; onPlaced: (order: PlacedOrder) => void; onRefused: (error: unknown) => void }

export const addressLine = (a: DeliveryAddress): string => [a.name, a.line1, a.line2, a.city, a.region, a.postalCode].map((part) => part.trim()).filter(Boolean).join(', ')

/** What the shopper is about to agree to, as the engine has it: the details, the order summary and the legal sentence. Nothing is priced here. */
export function Details({ cart, provider }: { cart: Cart; provider: string }) {
  const { colors } = useTheme()
  const option = cart.shippingOptions.find((o) => o.id === cart.shippingOption)
  const rows: [string, string][] = [[t('checkout.review.contact'), [cart.email, cart.phone].filter(Boolean).join(' · ')]]
  if (cart.shippingAddress) rows.push([t('checkout.review.deliverTo'), addressLine(cart.shippingAddress)])
  if (option) rows.push([t('checkout.review.method'), [optionName(option), optionPrice(option)].filter(Boolean).join(' · ')])
  rows.push([t('checkout.review.payment'), paymentName(provider)])
  return (
    <View style={styles.details}>
      {rows.map(([label, value]) => (
        <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={styles.detail}>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>{label}</Text>
          <Text style={{ color: colors.text, fontSize: 15 }}>{value}</Text>
        </View>
      ))}
    </View>
  )
}

export function ReviewStep({ cart, provider, onPlaced, onRefused }: Props) {
  const { client } = useShop()
  const { colors } = useTheme()
  const action = useAction(sendBack(onRefused))

  const place = async () => {
    const done = await action.run(() => placeOrder(client, provider))
    if (done) onPlaced(done.value)
  }

  return (
    <View style={styles.step}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('checkout.review.title')}
      </Text>
      <Details cart={cart} provider={provider} />
      <OrderSummary cart={cart} title={t('checkout.review.summary')} />
      <Text style={{ color: colors.textStrong, fontSize: 13, lineHeight: 19 }}>{t('checkout.review.legal')}</Text>
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button label={t('checkout.review.place')} busy={action.busy} onPress={() => void place()} />
    </View>
  )
}

const styles = StyleSheet.create({
  step: { gap: 14 },
  title: { fontSize: 20, fontWeight: '800' },
  details: { gap: 10 },
  detail: { gap: 2 },
})
