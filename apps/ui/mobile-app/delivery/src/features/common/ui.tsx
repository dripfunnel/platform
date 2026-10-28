import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'

export function Button({ label, onPress, kind = 'primary', disabled = false, busy = false }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const { colors, radii } = useTheme()
  const off = disabled || busy
  const filled = kind !== 'secondary'
  const background = kind === 'danger' ? colors.dangerButton : colors.brand
  const foreground = kind === 'danger' ? colors.onDanger : colors.brandContrast
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={[styles.button, { borderRadius: radii.button }, filled ? { backgroundColor: off ? colors.skeleton : background } : { borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.surface }]}
    >
      {busy ? <ActivityIndicator color={filled ? foreground : colors.text} /> : <Text style={[styles.buttonLabel, { color: filled ? (off ? colors.muted : foreground) : colors.text }]}>{label}</Text>}
    </Pressable>
  )
}

/** A link-looking action with a 44 px target. */
export function TextButton({ label, onPress, tone = 'link', disabled = false }: { label: string; onPress: () => void; tone?: 'link' | 'danger'; disabled?: boolean }) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.textButton}>
      <Text style={{ color: tone === 'danger' ? colors.danger : colors.link, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  )
}

type FieldProps = Pick<TextInputProps, 'autoCapitalize' | 'autoComplete' | 'keyboardType' | 'textContentType' | 'maxLength' | 'editable'> & {
  label: string
  value: string
  onChangeText: (value: string) => void
  /** Why the value is not accepted, in words; shown under the field and announced. */
  error?: string | null
  hint?: string
}

/** A labelled text field: the label above and read with it, the error below and announced. */
export function Field({ label, value, onChangeText, error = null, hint, editable = true, ...input }: FieldProps) {
  const { colors, radii, controlHeight } = useTheme()
  return (
    <View style={styles.field}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        placeholderTextColor={colors.muted}
        style={[styles.input, { minHeight: controlHeight + 8, borderRadius: radii.button, color: colors.text, backgroundColor: editable ? colors.surface : colors.neutralSurface, borderColor: error ? colors.danger : colors.fieldBorder }]}
        {...input}
      />
      {hint && !error ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

/** A refusal in words, announced when it appears. */
export function Refusal({ message }: { message: string | null }) {
  const { colors, radii } = useTheme()
  if (!message) return null
  return (
    <View accessibilityRole="alert" style={[styles.refusal, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, borderRadius: radii.button }]}>
      <Text style={{ color: colors.danger, fontSize: 14 }}>{message}</Text>
    </View>
  )
}

export function StateMessage({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="alert" style={styles.state}>
      <Text accessibilityRole="header" style={[styles.stateTitle, { color: colors.heading }]}>
        {title}
      </Text>
      <Text style={[styles.stateBody, { color: colors.muted }]}>{body}</Text>
      {actionLabel && onAction ? <Button kind="secondary" label={actionLabel} onPress={onAction} /> : null}
    </View>
  )
}

export function Loading() {
  const { colors } = useTheme()
  return (
    <View accessibilityLabel={t('common.loading')} accessibilityRole="progressbar" style={styles.loading}>
      <ActivityIndicator color={colors.brand} />
    </View>
  )
}

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.header, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.back}>
          <Text style={[styles.backGlyph, { color: colors.heading }]}>‹</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: colors.heading }]}>
        {title}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonLabel: { fontWeight: '700', fontSize: 16 },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  field: { gap: 6 },
  input: { borderWidth: 1, paddingHorizontal: 14, fontSize: 16 },
  refusal: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 64 },
  stateTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  stateBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 4, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 32, lineHeight: 36 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', paddingHorizontal: 12 },
})
