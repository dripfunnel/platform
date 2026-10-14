import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import type { DraftOption } from './draft'

type Props = {
  option: DraftOption
  disabled: boolean
  onRename: (name: string) => void
  onUp: (() => void) | null
  onRemove: () => void
  /** The choices typed, already split on commas. */
  onAdd: (names: string[]) => void
  onRemoveChoice: (name: string) => void
}

// One kind of choice (CATALOG-DESIGN.md D2, D10, D11): its name, its choices as chips with a way to remove each, a field to type
// more (commas separate several), and a move up and a remove for the kind itself.
export function OptionRow({ option, disabled, onRename, onUp, onRemove, onAdd, onRemoveChoice }: Props) {
  const { colors, radii } = useTheme()
  const [draft, setDraft] = useState('')
  const add = () => {
    const names = draft.split(',').map((name) => name.trim()).filter(Boolean)
    if (names.length === 0) return
    onAdd(names)
    setDraft('')
  }
  return (
    <View style={[styles.box, { borderColor: colors.border, borderRadius: radii.button }]}>
      <View style={styles.head}>
        <TextInput
          accessibilityLabel={t('products.choices.kindName')}
          value={option.name}
          onChangeText={onRename}
          editable={!disabled}
          autoCapitalize="words"
          style={[styles.name, { color: colors.heading, backgroundColor: colors.page, borderRadius: radii.small }]}
        />
        {onUp && !disabled ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('products.choices.moveUp', { name: option.name })} onPress={onUp} style={styles.icon}>
            <Text style={{ color: colors.textStrong, fontSize: 18 }}>↑</Text>
          </Pressable>
        ) : null}
        {!disabled ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('products.choices.removeKind', { name: option.name })} onPress={onRemove} style={styles.icon}>
            <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '700' }}>{t('products.choices.remove')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.chips}>
        {option.values.map((value) => (
          <View key={value.name} style={[styles.chip, { borderColor: colors.fieldBorder, backgroundColor: colors.surface }]}>
            <Text style={[styles.chipText, { color: colors.text }]}>{value.name}</Text>
            {!disabled ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('products.choices.removeValue', { name: value.name })} onPress={() => onRemoveChoice(value.name)} hitSlop={8} style={styles.chipX}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      {!disabled ? (
        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel={t('products.choices.valueLabel', { name: option.name })}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            returnKeyType="done"
            placeholder={t('products.choices.valuePlaceholder')}
            placeholderTextColor={colors.muted}
            style={[styles.add, { color: colors.text, borderColor: colors.fieldBorder, borderRadius: radii.button }]}
          />
          <Pressable accessibilityRole="button" onPress={add} style={[styles.addButton, { backgroundColor: colors.infoSurface, borderRadius: radii.button }]}>
            <Text style={{ color: colors.info, fontWeight: '700', fontSize: 14 }}>{t('products.choices.addValue')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, minHeight: 44, paddingHorizontal: 10, fontSize: 16, fontWeight: '700' },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingLeft: 12, paddingRight: 8, borderRadius: 18, borderWidth: 1 },
  chipText: { fontSize: 14 },
  chipX: { minWidth: 24, alignItems: 'center' },
  addRow: { flexDirection: 'row', gap: 8 },
  add: { flex: 1, minHeight: 44, borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 12, fontSize: 15 },
  addButton: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
})
