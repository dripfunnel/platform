import { StyleSheet, Text, View } from 'react-native'
import { reminderDelays, reminderPercents, reminderText, type ReminderStep } from '../../api/carts'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { Switch } from '../common/Switch'
import { TextArea } from '../common/TextArea'
import { TextField } from '../common/TextField'
import { PickerField } from '../settings/PickerField'
import { delayText, stepSummary } from './cartText'
import type { StepProblem } from './reminderDraft'

type Props = {
  step: ReminderStep
  index: number
  locked: boolean
  automatic: boolean
  /** Whether this step is used when the merchant sends a reminder by hand (the first one, with automatic sending off or on `youSend`). */
  byHand: boolean
  /** WhatsApp is offered only in an Indian store on `automatic`. */
  whatsapp: boolean
  canEdit: boolean
  problem: StepProblem | null
  /** Unsaved changes: a test sends the saved reminder, so there is nothing to send yet. */
  testBlocked: boolean
  onChange: (patch: Partial<ReminderStep>) => void
  onTest: () => void
}

// One of up to three reminders: when it goes, how, with what code, and what it says. A step past the first is locked below the plan's
// `automatic` and shows only that; a switched-off step shows only its switch.
export function ReminderStepCard({ step, index, locked, automatic, byHand, whatsapp, canEdit, problem, testBlocked, onChange, onTest }: Props) {
  const { colors } = useTheme()
  const n = step.position
  const open = !locked && step.enabled
  return (
    <SectionCard title={t('carts.reminders.step', { n })} sub={stepSummary(step, { locked, automatic, byHand })}>
      {index > 0 && !locked ? <Switch label={t('carts.reminders.stepOn', { n })} value={step.enabled} disabled={!canEdit} onChange={(enabled) => onChange({ enabled })} /> : null}
      {open ? (
        <>
          <PickerField
            label={t('carts.reminders.delay')}
            value={String(step.delayMinutes)}
            options={reminderDelays.map((minutes) => ({ value: String(minutes), label: delayText(minutes) }))}
            disabled={!canEdit}
            onChange={(value) => onChange({ delayMinutes: Number(value) })}
          />
          {whatsapp ? (
            <PickerField
              label={t('carts.reminders.sendBy')}
              value={step.channel}
              options={[
                { value: 'email', label: t('carts.reminders.email') },
                { value: 'whatsapp', label: t('carts.reminders.whatsapp') },
              ]}
              disabled={!canEdit}
              onChange={(value) => onChange({ channel: value === 'whatsapp' ? 'whatsapp' : 'email' })}
            />
          ) : null}
          {automatic ? (
            <PickerField
              label={t('carts.reminders.discount')}
              value={String(step.discountPercent ?? 0)}
              options={[{ value: '0', label: t('carts.reminders.noDiscount') }, ...reminderPercents.map((percent) => ({ value: String(percent), label: t('carts.reminders.percentOff', { percent }) }))]}
              disabled={!canEdit}
              onChange={(value) => onChange({ discountPercent: Number(value) || null })}
            />
          ) : null}
          {step.channel === 'email' ? (
            <TextField
              label={t('carts.reminders.subjectFor', { n })}
              value={step.subject}
              onChangeText={(subject) => onChange({ subject })}
              maxLength={reminderText.subject}
              editable={canEdit}
              autoCapitalize="sentences"
              invalid={problem === 'subject'}
            />
          ) : null}
          <TextArea label={t('carts.reminders.messageFor', { n })} value={step.body} onChangeText={(body) => onChange({ body })} editable={canEdit} lines={3} />
          <Text style={[styles.help, { color: colors.muted }]}>{t('carts.reminders.messageHelp')}</Text>
          {automatic && step.discountPercent ? <Text style={[styles.help, { color: colors.muted }]}>{t('carts.reminders.codeNote', { percent: step.discountPercent })}</Text> : null}
          {problem ? <Notice kind="error" text={t(`carts.reminders.errors.${problem}`, { n, subject: reminderText.subject, body: reminderText.body })} /> : null}
          {canEdit ? (
            <View style={styles.test}>
              <Button saves kind="secondary" label={t('carts.reminders.test')} disabled={testBlocked} onPress={onTest} />
              {testBlocked ? <Text style={[styles.help, { color: colors.muted }]}>{t('carts.reminders.testSaveFirst')}</Text> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  help: { fontSize: 13, lineHeight: 18 },
  test: { gap: 6 },
})
