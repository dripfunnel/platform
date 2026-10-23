import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { SheetFrame } from '../shell/BottomSheet'

export type PickerOption = { value: string; label: string; sub?: string }

type SheetProps = {
  title: string
  value: string | null
  options: readonly PickerOption[]
  onPick: (value: string) => void
  onClose: () => void
  /** A search box over the list, for the long ones (time zones, countries). */
  searchable?: boolean
}

// The list a choice is made from, as a bottom sheet (DESIGN.md §4): each option 50 or more tall, the one in force outlined.
export function PickerSheet({ title, value, options, onPick, onClose, searchable = false }: SheetProps) {
  const { colors, radii } = useTheme()
  const [search, setSearch] = useState('')
  const needle = search.trim().toLocaleLowerCase()
  const shown = needle === '' ? options : options.filter((option) => option.label.toLocaleLowerCase().includes(needle) || option.value.toLocaleLowerCase().includes(needle))
  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {title}
      </Text>
      {searchable ? (
        <TextInput
          accessibilityLabel={t('settings.common.search')}
          value={search}
          onChangeText={setSearch}
          placeholder={t('settings.common.search')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.search, { color: colors.text, borderColor: colors.fieldBorder, borderRadius: radii.button }]}
        />
      ) : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {shown.length === 0 ? <Text style={[styles.help, { color: colors.muted }]}>{t('settings.common.noMatch')}</Text> : null}
        {shown.map((option) => {
          const selected = option.value === value
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onPick(option.value)}
              style={[styles.option, { borderColor: selected ? colors.focus : colors.border, borderWidth: selected ? 2 : 1, borderRadius: radii.button, backgroundColor: colors.surface }]}
            >
              <Text style={[styles.optionLabel, { color: colors.text }]}>{option.label}</Text>
              {option.sub ? <Text style={[styles.optionSub, { color: colors.muted }]}>{option.sub}</Text> : null}
            </Pressable>
          )
        })}
      </ScrollView>
    </SheetFrame>
  )
}

type Props = {
  label: string
  value: string
  options: readonly PickerOption[]
  onChange: (value: string) => void
  help?: string | undefined
  disabled?: boolean
  searchable?: boolean
  /** What the field shows when `value` is none of the options (nothing chosen yet). */
  placeholder?: string
}

// A choice from a list, as a field that opens the sheet. 50 tall like every field.
export function PickerField({ label, value, options, onChange, help, disabled = false, searchable = false, placeholder = '' }: Props) {
  const { colors, radii } = useTheme()
  const [open, setOpen] = useState(false)
  const chosen = options.find((option) => option.value === value)
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.box, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button, opacity: disabled ? 0.6 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.value, { color: chosen ? colors.text : colors.muted }]}>
          {chosen?.label ?? placeholder}
        </Text>
        <Text style={[styles.caret, { color: colors.muted }]}>{t('shell.caret')}</Text>
      </Pressable>
      {help ? <Text style={[styles.help, { color: colors.muted }]}>{help}</Text> : null}
      {open ? (
        <PickerSheet
          title={label}
          value={value}
          options={options}
          searchable={searchable}
          onClose={() => setOpen(false)}
          onPick={(picked) => {
            setOpen(false)
            onChange(picked)
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  box: { height: 50, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  value: { flex: 1, fontSize: 16 },
  caret: { fontSize: 11 },
  help: { fontSize: 13, lineHeight: 18 },
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  search: { borderWidth: 1, paddingHorizontal: 12, fontSize: 16, minHeight: 50 },
  list: { maxHeight: 360 },
  option: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8, gap: 2 },
  optionLabel: { fontSize: 15, fontWeight: '600' },
  optionSub: { fontSize: 12 },
})
