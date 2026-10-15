import { useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { useOnline } from './connection'

export type SheetChoice = { value: string; label: string; sub?: string }

/** design.md §4's modal spec as a phone draws it: title, body, choices, one input, and `danger` for what can't be undone. */
export type SheetSpec = {
  title: string
  tag?: string
  body?: string
  choices?: readonly SheetChoice[]
  /** `initial` starts the field with a value (a rename); `single` makes it one line, for a name, rather than a few. */
  input?: { label: string; placeholder?: string; error?: string; initial?: string; single?: boolean }
  confirm: string
  /** Absent means "Cancel"; `null` means no cancel button. */
  cancel?: string | null
  danger?: boolean
  /** The confirm button writes, so it is off while the phone is offline (FIRST-RELEASE.md §3.3). */
  saves?: boolean
  onConfirm: (result: { choice: string | null; text: string }) => void | Promise<void>
}

// Dialogs are bottom sheets (DESIGN.md §4): top corners 24, a grab handle, full-width buttons 50 tall, stacked with the
// confirm button on top. The system back gesture closes it.
export function SheetFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { colors, radii } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <Pressable accessibilityLabel={t('common.cancel')} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, paddingBottom: insets.bottom + 20 }]}>
          <View style={[styles.handle, { backgroundColor: colors.fieldBorder }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function BottomSheet({ spec, onClose }: { spec: SheetSpec; onClose: () => void }) {
  const { colors, radii } = useTheme()
  const [choice, setChoice] = useState<string | null>(spec.choices?.[0]?.value ?? null)
  const [text, setText] = useState(spec.input?.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (spec.input?.error && text.trim() === '') {
      setError(spec.input.error)
      return
    }
    setBusy(true)
    try {
      await spec.onConfirm({ choice, text: text.trim() })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SheetFrame onClose={onClose}>
      {spec.tag ? <Text style={[styles.tag, { color: colors.link }]}>{spec.tag}</Text> : null}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {spec.title}
      </Text>
      {spec.body ? <Text style={[styles.body, { color: colors.textStrong }]}>{spec.body}</Text> : null}
      {spec.choices?.map((option) => {
        const selected = option.value === choice
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setChoice(option.value)}
            style={[styles.choice, { borderColor: selected ? colors.focus : colors.fieldBorder, borderWidth: selected ? 2 : 1, borderRadius: radii.button, backgroundColor: colors.surface }]}
          >
            <View style={[styles.dot, { borderColor: selected ? colors.focus : colors.muted, borderWidth: selected ? 5 : 1.5 }]} />
            <View style={styles.choiceText}>
              <Text style={[styles.choiceLabel, { color: colors.text }]}>{option.label}</Text>
              {option.sub ? <Text style={[styles.choiceSub, { color: colors.muted }]}>{option.sub}</Text> : null}
            </View>
          </Pressable>
        )
      })}
      {spec.input ? (
        <View style={styles.field}>
          <Text style={[styles.choiceLabel, { color: colors.text }]}>{spec.input.label}</Text>
          <TextInput
            accessibilityLabel={spec.input.label}
            value={text}
            onChangeText={(value) => {
              setText(value)
              setError(null)
            }}
            placeholder={spec.input.placeholder}
            placeholderTextColor={colors.muted}
            multiline={spec.input.single !== true}
            numberOfLines={spec.input.single === true ? 1 : 3}
            style={[spec.input.single === true ? styles.line : styles.textarea, { color: colors.text, borderColor: error ? colors.danger : colors.fieldBorder, borderRadius: radii.button }]}
          />
          {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : null}
        </View>
      ) : null}
      <View style={styles.buttons}>
        <SheetConfirm label={spec.confirm} danger={spec.danger === true} saves={spec.saves === true} busy={busy} onPress={() => void confirm()} />
        {spec.cancel === null ? null : <Button kind="secondary" label={spec.cancel ?? t('common.cancel')} onPress={onClose} />}
      </View>
    </SheetFrame>
  )
}

// The confirm button: the brand colour, or red for something that can't be undone.
function SheetConfirm({ label, danger, saves, busy, onPress }: { label: string; danger: boolean; saves: boolean; busy: boolean; onPress: () => void }) {
  const { colors, radii } = useTheme()
  const online = useOnline()
  if (!danger) return <Button label={label} onPress={onPress} busy={busy} saves={saves} />
  const off = busy || (saves && !online)
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: off }} disabled={off} onPress={onPress} style={[styles.danger, { backgroundColor: colors.dangerButton, borderRadius: radii.button, opacity: off && !busy ? 0.5 : 1 }]}>
      <Text style={[styles.dangerLabel, { color: colors.onDanger }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', paddingTop: 10 },
  handle: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 6 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  tag: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700' },
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56 },
  dot: { width: 20, height: 20, borderRadius: 10 },
  choiceText: { flex: 1, gap: 2 },
  choiceLabel: { fontSize: 14, fontWeight: '700' },
  choiceSub: { fontSize: 12 },
  field: { gap: 6 },
  textarea: { borderWidth: 1, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  line: { borderWidth: 1, paddingHorizontal: 12, fontSize: 16, minHeight: 50 },
  buttons: { gap: 8, paddingTop: 4 },
  danger: { height: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  dangerLabel: { fontSize: 16, fontWeight: '700' },
})
