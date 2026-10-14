import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ProductRow } from '../../api/products'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Icon } from '../shell/Icon'
import { ProductPhoto } from './ProductPhoto'
import { StatusChip } from './StatusChip'
import { priceText, readyText, statusOf, statusTone, stockText, subText, toneColours } from './productView'

type Props = { row: ProductRow; onOpen: () => void; onApprove?: () => void; onSendBack?: () => void }

// A product as a stacked card (DESIGN.md §4; CatList's phone cards): photo, name and what it says, price and stock, its status.
// A waiting supplier product carries Approve and Send back for a seat that may (CATALOG-DESIGN.md L3).
export function ProductCard({ row, onOpen, onApprove, onSendBack }: Props) {
  const { colors, radii } = useTheme()
  const status = statusOf(row)
  const stock = stockText(row)
  const ready = readyText(row)
  const review = status === 'pending' && onApprove && onSendBack
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('products.row.open', { name: row.name })}
        onPress={onOpen}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
      >
        <ProductPhoto path={row.photoUrl} size={56} label={row.name} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {row.name}
          </Text>
          <Text numberOfLines={1} style={[styles.sub, { color: colors.muted }]}>
            {subText(row)}
          </Text>
          <Text style={[styles.price, { color: colors.text }]}>{priceText(row)}</Text>
          <View style={styles.line}>
            <Text style={[styles.stock, { color: toneColours(colors, stock.tone).fg }]}>{stock.text}</Text>
            <StatusChip label={t(`products.status.${status}`)} tone={statusTone[status]} />
          </View>
          {ready && !ready.ready ? <Text style={[styles.ready, { color: colors.warning }]}>{ready.text}</Text> : null}
          {row.supplier && !row.supplierRemoved ? <Text style={[styles.sub, { color: colors.muted }]}>{t('products.row.from', { supplier: row.supplier.name })}</Text> : null}
        </View>
        <Icon name="chevron" size={18} color={colors.muted} />
      </Pressable>
      {review ? (
        <View style={styles.review}>
          <ReviewButton label={t('products.review.sendBack')} onPress={onSendBack} tone="danger" />
          <ReviewButton label={t('products.review.approveShort')} onPress={onApprove} tone="success" />
        </View>
      ) : null}
    </View>
  )
}

function ReviewButton({ label, onPress, tone }: { label: string; onPress: () => void; tone: 'success' | 'danger' }) {
  const { colors, radii } = useTheme()
  const approve = tone === 'success'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.reviewButton, { borderRadius: radii.button, backgroundColor: approve ? colors.success : colors.surface, borderColor: approve ? colors.success : colors.dangerBorder }]}
    >
      <Text style={[styles.reviewLabel, { color: approve ? colors.surface : colors.danger }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12 },
  price: { fontSize: 13 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 2 },
  stock: { fontSize: 12 },
  ready: { fontSize: 12 },
  review: { flexDirection: 'row', gap: 8 },
  reviewButton: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  reviewLabel: { fontSize: 14, fontWeight: '700' },
})
