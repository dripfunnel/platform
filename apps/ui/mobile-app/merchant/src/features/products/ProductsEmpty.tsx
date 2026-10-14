import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'

export type EmptyKind = 'first' | 'supplierFirst' | 'noResults'

type Props = { kind: EmptyKind; search: string; onAdd: (() => void) | null; onClear: () => void }

// The list's empty states (CATALOG-DESIGN.md A1, B8): a store with no products yet, a supplier with none, and a search or
// filter that matches nothing. A supplier's count is of its own products, so it never learns the store has others.
export function ProductsEmpty({ kind, search, onAdd, onClear }: Props) {
  const { colors, radii } = useTheme()
  const words =
    kind === 'first'
      ? { title: t('products.empty.title'), body: t('products.empty.body') }
      : kind === 'supplierFirst'
        ? { title: t('products.supplierEmpty.title'), body: t('products.supplierEmpty.body') }
        : { title: search ? t('products.noResults.search', { search }) : t('products.noResults.filters'), body: t('products.noResults.body') }
  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {words.title}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>{words.body}</Text>
      {kind === 'noResults' ? <Button kind="secondary" label={t('products.noResults.clear')} onPress={onClear} /> : onAdd ? <Button label={t('products.empty.add')} onPress={onAdd} saves /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 21 },
})
