import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Price } from '../../api/catalogue'
import { t } from '../../messages'
import { money, taxLine } from './words'

type Props = { price: Price | null; compareAt: Price | null; from: boolean; pricesIncludeTax: boolean }

/** The price exactly as the API gives it, with its tax label (storefront/DESIGN.md: the price and its tax label are never separated). */
export function ProductPrice({ price, compareAt, from, pricesIncludeTax }: Props) {
  const { colors } = useTheme()
  if (!price) return null
  const text = from ? t('product.from', { price: money(price) }) : money(price)
  const was = compareAt && compareAt.amount !== price.amount ? money(compareAt) : null
  return (
    <View style={styles.block} accessible accessibilityLabel={[text, was ? t('product.was', { price: was }) : null, taxLine(pricesIncludeTax)].filter(Boolean).join(', ')}>
      <View style={styles.line}>
        <Text style={[styles.price, { color: colors.text }]}>{text}</Text>
        {was ? <Text style={[styles.was, { color: colors.muted }]}>{was}</Text> : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{taxLine(pricesIncludeTax)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 2 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10 },
  price: { fontSize: 21, fontWeight: '700' },
  was: { fontSize: 14, textDecorationLine: 'line-through' },
})
