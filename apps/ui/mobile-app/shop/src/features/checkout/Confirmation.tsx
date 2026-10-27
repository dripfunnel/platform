import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Cart, PlacedOrder } from '../../api/cart'
import { t } from '../../messages'
import { money } from '../catalogue/words'
import { Button } from '../common/ui'
import { OrderSummary } from './OrderSummary'
import { Details } from './ReviewStep'

/** The order is placed: its number, what to do next, and what was ordered. `paid` only when it was read back as paid after a provider's sheet. */
export function Confirmation({ order, cart, paid = false, onDone }: { order: PlacedOrder; cart: Cart; paid?: boolean; onDone: () => void }) {
  const { colors, radii } = useTheme()
  const total = order.total ?? cart.total
  const bank = order.provider === 'bank_transfer'
  const cod = order.provider === 'cod'
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {bank || cod || paid ? (
        <View style={[styles.pill, { backgroundColor: bank ? colors.warningSurface : paid ? colors.successSurface : colors.neutralSurface }]}>
          <Text style={{ color: bank ? colors.warning : paid ? colors.success : colors.textStrong, fontWeight: '700', fontSize: 13 }}>{t(bank ? 'checkout.placed.pillBank' : paid ? 'checkout.placed.pillPaid' : 'checkout.placed.pillCod')}</Text>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 24, fontWeight: '800' }}>
        {t('checkout.placed.heading')}
      </Text>
      <Text style={{ color: colors.textStrong, fontSize: 15 }}>{cart.email ? t('checkout.placed.body', { number: order.number, email: cart.email }) : t('checkout.placed.bodyNoEmail', { number: order.number })}</Text>
      {bank && total ? (
        <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder, borderRadius: radii.card }]}>
          <Text style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>{t('checkout.placed.bankTitle', { total: money(total) })}</Text>
          <Text style={{ color: colors.text, fontSize: 14 }}>{t('checkout.placed.bankBody', { number: order.number })}</Text>
          {order.instructions ? <Text selectable style={{ color: colors.text, fontSize: 14 }}>{order.instructions}</Text> : null}
        </View>
      ) : null}
      {cod && total ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          <Text style={{ color: colors.text, fontSize: 14 }}>{t('checkout.placed.codBody', { total: money(total) })}</Text>
        </View>
      ) : null}
      <Details cart={cart} provider={order.provider} />
      <OrderSummary cart={cart} title={t('checkout.placed.orderTitle', { number: order.number })} />
      <Button label={t('checkout.placed.done')} onPress={onDone} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { gap: 14, padding: 16, paddingBottom: 40 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  card: { borderWidth: 1, padding: 14, gap: 8 },
})
