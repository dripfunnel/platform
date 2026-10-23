import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

type Props = { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; editable?: boolean; optional?: string; lines?: number }

// A labelled multi-line field for the description; a single line is common/TextField.
export function TextArea({ label, value, onChangeText, placeholder, editable = true, optional, lines = 4 }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>
        {label}
        {optional ? <Text style={[styles.optional, { color: colors.muted }]}> {optional}</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        multiline
        numberOfLines={lines}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.area, { color: colors.text, borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button, minHeight: lines * 24 + 24 }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  optional: { fontWeight: '400' },
  area: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, textAlignVertical: 'top' },
})
