import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { ChoiceRow } from '../../common/ChoiceRow'
import { Notice } from '../../common/Notice'
import { SheetConfirm, SheetFrame } from '../../shell/BottomSheet'

export type AskChoice = { value: string; label: string }

type Props = {
  title: string
  /** What saving will do, said before it does it. */
  body: string
  choices?: readonly AskChoice[]
  initial?: string
  confirm: string
  onClose: () => void
  /** Saves; resolves with the words for what went wrong, or null once it went through (the screen closes the sheet). A refusal keeps what was chosen. */
  onSubmit: (choice: string) => Promise<string | null>
  /** What is wrong with a choice before anything is sent. */
  check?: (choice: string) => string | null
}

// The questions Save asks (Start now / Schedule / Keep off on a new offer; a live offer's change): a bottom sheet that states the
// consequence first and keeps a refusal inside it (DESIGN.md §4).
export function AskSheet({ title, body, choices = [], initial = '', confirm, onClose, onSubmit, check }: Props) {
  const { colors } = useTheme()
  const [choice, setChoice] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const submit = async () => {
    const problem = check?.(choice) ?? null
    if (problem !== null) return setFailure(problem)
    setBusy(true)
    setFailure(null)
    const refused = await onSubmit(choice)
    if (refused !== null) setFailure(refused)
    setBusy(false)
  }

  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: colors.textStrong }]}>{body}</Text>
      {choices.map((option) => (
        <ChoiceRow key={option.value} label={option.label} selected={choice === option.value} onPress={() => setChoice(option.value)} />
      ))}
      {failure ? <Notice kind="error" text={failure} /> : null}
      <View style={styles.buttons}>
        <SheetConfirm label={confirm} danger={false} saves busy={busy} onPress={() => void submit()} />
        <Button kind="secondary" label={t('common.cancel')} onPress={onClose} disabled={busy} />
      </View>
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  buttons: { gap: 8, paddingTop: 4 },
})
