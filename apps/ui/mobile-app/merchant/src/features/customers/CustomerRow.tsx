import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { CustomerSummary } from '../../api/customers'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { rowSub, spentText } from './customerFacts'

// One person as a stacked card (DESIGN.md §4): the name with their city and tags under it, what they've spent (the API's figure) and
// how many orders on the right.
export function CustomerRow({ row, onOpen }: { row: CustomerSummary; onOpen: () => void }) {
  const { colors, radii } = useTheme()
  const name = row.name ?? t('customers.row.noName')
  const spent = spentText(row.spent)
  const sub = rowSub(row)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('customers.row.open', { name })}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.hover : colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
    >
      <View style={styles.text}>
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        {sub ? (
          <Text numberOfLines={2} style={[styles.sub, { color: colors.muted }]}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={styles.side}>
        {spent ? <Text style={[styles.spent, { color: colors.text }]}>{spent}</Text> : null}
        <Text style={[styles.sub, { color: colors.muted }]}>{row.orders > 0 ? tCount('customers.row.orders', row.orders) : t('customers.row.noOrders')}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { minHeight: 64, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  side: { alignItems: 'flex-end', gap: 2, maxWidth: '45%' },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
  spent: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
})
