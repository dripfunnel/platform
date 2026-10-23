import { StyleSheet, TextInput, type TextInputProps } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

type Props = { label: string; value: string; onChangeText: (value: string) => void; editable?: boolean; invalid?: boolean; keyboardType?: TextInputProps['keyboardType']; placeholder?: string }

// A compact field for a price or a count inside a row of versions: 44 tall, labelled for a screen reader rather than on screen.
export function CompactField({ label, value, onChangeText, editable = true, invalid = false, keyboardType = 'decimal-pad', placeholder }: Props) {
  const { colors, radii } = useTheme()
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      editable={editable}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      autoCorrect={false}
      style={[styles.field, { color: colors.text, borderColor: invalid ? colors.danger : colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}
    />
  )
}

const styles = StyleSheet.create({
  field: { minHeight: 44, borderWidth: 1.5, paddingHorizontal: 12, fontSize: 16 },
})
