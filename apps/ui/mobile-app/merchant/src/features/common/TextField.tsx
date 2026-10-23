import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

type Props = {
  label: string
  value: string
  onChangeText: (value: string) => void
  help?: string | undefined
  invalid?: boolean
  /** A password: hidden, with a Show/Hide control. */
  secret?: boolean
  /** Digits and codes: wide letter-spacing in a monospace face. */
  code?: boolean
} & Pick<TextInputProps, 'keyboardType' | 'autoComplete' | 'textContentType' | 'maxLength' | 'placeholder' | 'autoCapitalize' | 'returnKeyType' | 'onSubmitEditing' | 'editable'>

// A labelled field 50 px tall (DESIGN.md §4), so the label is the accessibility name and the keyboard type fits the value.
export function TextField({ label, value, onChangeText, help, invalid = false, secret = false, code = false, autoCapitalize = 'none', ...input }: Props) {
  const { colors, radii } = useTheme()
  const [shown, setShown] = useState(false)
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={[styles.box, { borderColor: invalid ? colors.danger : colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secret && !shown}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text }, code ? styles.code : null]}
          {...input}
        />
        {secret ? (
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? t('common.hide') : t('common.show')} onPress={() => setShown(!shown)} style={styles.toggle}>
            <Text style={[styles.toggleText, { color: colors.link }]}>{shown ? t('common.hide') : t('common.show')}</Text>
          </Pressable>
        ) : null}
      </View>
      {help ? <Text style={[styles.help, { color: invalid ? colors.danger : colors.muted }]}>{help}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  box: { height: 50, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 4 },
  input: { flex: 1, fontSize: 16, minHeight: 44 },
  code: { letterSpacing: 6, fontFamily: 'monospace' },
  toggle: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  toggleText: { fontSize: 13, fontWeight: '700' },
  help: { fontSize: 13, lineHeight: 18 },
})
