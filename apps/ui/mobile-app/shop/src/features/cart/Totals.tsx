import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Cart } from '../../api/cart'
import { t } from '../../messages'
import { money } from '../catalogue/words'

type Row = { key: string; label: string; value: string }

/** Whether the delivery row is known yet: the cart says "chosen at checkout", checkout says "next step", until an option is chosen. */
export type Stage = 'cart' | 'checkout'

/** The rows the engine priced, in the order the shopper reads them; nothing here is added up by the app. */
export const totalRows = (cart: Cart, stage: Stage): Row[] => {
  const rows: Row[] = []
  if (cart.subtotal) rows.push({ key: 'subtotal', label: t('cart.totals.subtotal'), value: money(cart.subtotal) })
  const named = cart.discounts.flatMap((d, i) => (d.amount ? [{ key: `discount-${i}`, label: d.name || t('cart.totals.discount'), value: `−${money(d.amount)}` }] : []))
  rows.push(...named)
  if (named.length === 0 && cart.discount && cart.discount.amount !== '0') rows.push({ key: 'discount', label: t('cart.totals.discount'), value: `−${money(cart.discount)}` })
  if (cart.needsShipping || cart.shippingOption) {
    const value = cart.shippingOption && cart.shipping ? (cart.shipping.amount === '0' ? t('cart.totals.free') : money(cart.shipping)) : t(stage === 'cart' ? 'cart.totals.later' : 'cart.totals.next')
    rows.push({ key: 'delivery', label: t('cart.totals.delivery'), value })
  }
  if (cart.tax && !cart.tax.pricesIncludeTax && cart.tax.amount) rows.push({ key: 'tax', label: t('cart.totals.tax'), value: money(cart.tax.amount) })
  return rows
}

/** The tax sentence under the total: what the price includes, or that tax is worked out later. */
export const taxNote = (cart: Cart): string | null => {
  if (cart.tax?.pricesIncludeTax) return cart.tax.amount ? t('cart.totals.includes', { amount: money(cart.tax.amount) }) : t('product.tax.included')
  return cart.tax?.amount ? null : t('product.tax.added')
}

export function Totals({ cart, stage }: { cart: Cart; stage: Stage }) {
  const { colors } = useTheme()
  const note = taxNote(cart)
  return (
    <View style={styles.block}>
      {totalRows(cart, stage).map((row) => (
        <View key={row.key} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
          <Text style={{ color: colors.text, fontSize: 15 }}>{row.label}</Text>
          <Text style={{ color: colors.text, fontSize: 15 }}>{row.value}</Text>
        </View>
      ))}
      {cart.total ? (
        <View style={[styles.row, styles.total, { borderColor: colors.border }]} accessible accessibilityLabel={`${t('cart.totals.total')}: ${money(cart.total)}`}>
          <Text style={{ color: colors.heading, fontSize: 17, fontWeight: '800' }}>{t('cart.totals.total')}</Text>
          <Text style={{ color: colors.heading, fontSize: 17, fontWeight: '800' }}>{money(cart.total)}</Text>
        </View>
      ) : null}
      {note ? <Text style={{ color: colors.muted, fontSize: 13 }}>{note}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  total: { borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
})
