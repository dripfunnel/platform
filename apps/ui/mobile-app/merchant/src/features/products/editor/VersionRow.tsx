import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { CompactField } from './CompactField'
import { StockInputs } from './StockInputs'
import type { Draft, DraftVersion } from './draft'
import type { StockContext } from './stock'

type Props = {
  draft: Draft
  update: (change: (draft: Draft) => Draft) => void
  version: DraftVersion
  /** Where it is in `draft.versions`, so an edit lands on this row whatever the filter shows. */
  at: number
  disabled: boolean
  priceInvalid: boolean
  stock: StockContext | null
  onAdjust: (version: DraftVersion) => void
  onVisibility: () => void
}

// One version as a card (CATALOG-DESIGN.md D4): its choices, a price, its counts, and whether it is on the store. A combination
// the seller doesn't make shows as such, with a way to add it back.
export function VersionRow({ draft, update, version, at, disabled, priceInvalid, stock, onAdjust, onVisibility }: Props) {
  const { colors, radii } = useTheme()
  const name = version.choices.join(' / ')
  const state = version.removed ? t('products.versions.notMade') : version.visible ? t('products.versions.visible') : t('products.versions.hidden')
  const set = (patch: Partial<Pick<DraftVersion, 'price'>>) => update((d) => ({ ...d, versions: d.versions.map((candidate, i) => (i === at ? { ...candidate, ...patch } : candidate)) }))
  return (
    <View style={[styles.row, { borderColor: colors.border, borderRadius: radii.button, backgroundColor: version.removed ? colors.page : colors.surface, opacity: version.removed ? 0.7 : 1 }]}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}: ${state}`}
          disabled={disabled}
          onPress={onVisibility}
          style={styles.state}
        >
          <Text style={{ color: version.removed ? colors.focus : version.visible ? colors.success : colors.muted, fontSize: 13, fontWeight: '600' }}>{state}</Text>
        </Pressable>
      </View>
      {!version.removed ? (
        <>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.muted }]}>{t('products.versions.price')}</Text>
            <View style={styles.input}>
              <CompactField label={t('products.versions.priceOf', { name })} value={version.price} onChangeText={(price) => set({ price })} editable={!disabled} invalid={priceInvalid} />
            </View>
          </View>
          {stock ? <StockInputs draft={draft} update={update} version={version} stock={stock} onAdjust={onAdjust} /> : null}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  state: { minHeight: 44, justifyContent: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 14 },
  input: { width: 140 },
})
