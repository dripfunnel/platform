import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Cart } from '../../api/cart'
import { locale, t } from '../../messages'
import { money } from '../catalogue/words'
import { Totals } from '../cart/Totals'

/** The cart's lines and totals exactly as the engine priced them: the order summary the shopper reads before paying. */
export function OrderSummary({ cart, title }: { cart: Cart; title?: string }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      {title ? (
        <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
          {title}
        </Text>
      ) : null}
      {cart.lines.map((line) => (
        <View key={line.versionId} style={styles.line} accessible accessibilityLabel={[t('checkout.summary.line', { name: line.name, count: formatNumber(line.quantity, locale) }), line.versionName, line.lineTotal ? money(line.lineTotal) : null].filter(Boolean).join(', ')}>
          <View style={styles.lineText}>
            <Text style={{ color: colors.text, fontSize: 14 }}>{t('checkout.summary.line', { name: line.name, count: formatNumber(line.quantity, locale) })}</Text>
            {line.versionName ? <Text style={{ color: colors.muted, fontSize: 13 }}>{line.versionName}</Text> : null}
          </View>
          {line.lineTotal ? <Text style={{ color: colors.text, fontSize: 14 }}>{money(line.lineTotal)}</Text> : null}
        </View>
      ))}
      <Totals cart={cart} stage="checkout" />
    </View>
  )
}

/** The total at the top of every step, opening into the summary. */
export function SummaryBar({ cart }: { cart: Cart }) {
  const { colors, radii } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t(open ? 'checkout.summary.hide' : 'checkout.summary.show')}${cart.total ? `, ${t('cart.totals.total')} ${money(cart.total)}` : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={[styles.barButton, { borderColor: colors.border, borderRadius: radii.button, backgroundColor: colors.surface }]}
      >
        <Text style={{ color: colors.link, fontWeight: '700' }}>{t(open ? 'checkout.summary.hide' : 'checkout.summary.show')}</Text>
        {cart.total ? <Text style={{ color: colors.heading, fontWeight: '800', fontSize: 16 }}>{money(cart.total)}</Text> : null}
      </Pressable>
      {open ? <OrderSummary cart={cart} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: 14, gap: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineText: { flex: 1, gap: 2 },
  bar: { gap: 8 },
  barButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, borderWidth: 1 },
})
