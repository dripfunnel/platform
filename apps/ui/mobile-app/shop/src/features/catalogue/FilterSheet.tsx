import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import type { Facet, ProductSort } from '../../api/catalogue'
import { locale, t, type MessageKey } from '../../messages'
import { Button, ChoiceRow, Sheet } from '../common/ui'

/** The store's filters as the API offers them, with how many products each value has; chosen together, applied once. */
export function FilterSheet({ facets, selected, onApply, onClose }: { facets: Facet[]; selected: string[]; onApply: (ids: string[]) => void; onClose: () => void }) {
  const { colors } = useTheme()
  const [draft, setDraft] = useState(selected)
  const toggle = (id: string) => setDraft((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  return (
    <Sheet
      title={t('collection.filters')}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Button label={t('collection.showProducts')} onPress={() => onApply(draft)} />
          {draft.length > 0 ? <Button kind="secondary" label={t('collection.clearAll')} onPress={() => setDraft([])} /> : null}
        </View>
      }
    >
      {facets.map((facet) => (
        <View key={facet.id} style={styles.facet}>
          <Text accessibilityRole="header" style={[styles.facetName, { color: colors.muted }]}>
            {facet.name}
          </Text>
          {facet.values.map((value) => (
            <ChoiceRow key={value.id} role="checkbox" label={value.name} detail={formatNumber(value.count, locale)} selected={draft.includes(value.id)} onPress={() => toggle(value.id)} />
          ))}
        </View>
      ))}
    </Sheet>
  )
}

export const sorts: { value: ProductSort | null; label: MessageKey }[] = [
  { value: null, label: 'collection.sorts.featured' },
  { value: 'NEWEST', label: 'collection.sorts.newest' },
  { value: 'PRICE_LOW', label: 'collection.sorts.priceLow' },
  { value: 'PRICE_HIGH', label: 'collection.sorts.priceHigh' },
]

export function SortSheet({ selected, onPick, onClose }: { selected: ProductSort | null; onPick: (sort: ProductSort | null) => void; onClose: () => void }) {
  return (
    <Sheet title={t('collection.sortTitle')} onClose={onClose}>
      {sorts.map((option) => (
        <ChoiceRow key={option.label} role="radio" label={t(option.label)} selected={option.value === selected} onPress={() => onPick(option.value)} />
      ))}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  facet: { gap: 2, paddingTop: 8 },
  facetName: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  footer: { gap: 8 },
})
