import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'

type FieldProps = Pick<TextInputProps, 'autoCapitalize' | 'autoComplete' | 'keyboardType' | 'textContentType' | 'maxLength' | 'returnKeyType' | 'onSubmitEditing'> & {
  label: string
  value: string
  onChangeText: (value: string) => void
  /** Why the value is not accepted, in words; shown under the field and read with it. */
  error?: string | null
  optional?: boolean
  editable?: boolean
  secure?: boolean
}

/** A labelled text field: the label is above it and read with it, the error is below and announced. */
export function Field({ label, value, onChangeText, error = null, optional = false, editable = true, secure = false, ...input }: FieldProps) {
  const { colors, radii, controlHeight } = useTheme()
  const [shown, setShown] = useState(false)
  const full = optional ? `${label} (${t('form.optional')})` : label
  return (
    <View style={styles.field}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{full}</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={full}
          editable={editable}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure && !shown}
          autoCorrect={false}
          placeholderTextColor={colors.muted}
          style={[
            styles.input,
            { minHeight: controlHeight, borderRadius: radii.button, color: colors.text, backgroundColor: editable ? colors.surface : colors.neutralSurface, borderColor: error ? colors.danger : colors.fieldBorder },
            secure ? styles.withToggle : null,
          ]}
          {...input}
        />
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? t('form.hidePassword') : t('form.showPassword')} onPress={() => setShown(!shown)} style={styles.toggle}>
            <Text style={{ color: colors.link, fontWeight: '700' }}>{shown ? t('form.hide') : t('form.show')}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { justifyContent: 'center' },
  input: { borderWidth: 1, paddingHorizontal: 14, fontSize: 16 },
  withToggle: { paddingRight: 72 },
  toggle: { position: 'absolute', right: 0, minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
})
