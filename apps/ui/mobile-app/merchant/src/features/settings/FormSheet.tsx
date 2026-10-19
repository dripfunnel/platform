import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { errorMessage, type ErrorContext } from '../../messages/errorMessage'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SheetConfirm, SheetFrame } from '../shell/BottomSheet'
import { useFeedback } from '../shell/Feedback'

type Props = {
  title: string
  /** What the write will do, said before it does it (the card's Prompt: every write states its consequence first). */
  body?: string
  confirm: string
  /** What the other button says when "Cancel" would read as the confirm's own action ("Keep order"). */
  cancel?: string
  danger?: boolean
  context: ErrorContext
  onClose: () => void
  /** The write; resolves with what to say in the toast, or null for a step that leaves the sheet as it is. A refusal stays in the sheet, in words by its code, with what was typed. */
  onSubmit: () => Promise<string | null>
  /** False while there is nothing to send yet (nothing changed). */
  ready?: boolean
  /** What is wrong with what was typed, said before anything is sent; null when it can go. */
  check?: () => string | null
  children?: ReactNode
}

// A dialog that asks for something and writes (DESIGN.md §4: bottom sheets, the confirm button on top, full width, 50 tall). It closes only
// when the write succeeded, so a refusal never costs what was typed.
export function FormSheet({ title, body, confirm, cancel, danger = false, context, onClose, onSubmit, ready = true, check, children }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const submit = async () => {
    const problem = check?.() ?? null
    if (problem !== null) {
      setFailure(problem)
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const message = await onSubmit()
      if (message === null) {
        setBusy(false)
        return
      }
      feedback.toast({ message })
      onClose()
    } catch (error) {
      setFailure(errorMessage(error, context))
      setBusy(false)
    }
  }

  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {title}
      </Text>
      {body ? <Text style={[styles.body, { color: colors.textStrong }]}>{body}</Text> : null}
      {children}
      {failure ? <Notice kind="error" text={failure} /> : null}
      <View style={styles.buttons}>
        {ready ? <SheetConfirm label={confirm} danger={danger} saves busy={busy} onPress={() => void submit()} /> : <Button label={confirm} disabled onPress={() => undefined} />}
        <Button kind="secondary" label={cancel ?? t('common.cancel')} onPress={onClose} />
      </View>
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  buttons: { gap: 8, paddingTop: 4 },
})
