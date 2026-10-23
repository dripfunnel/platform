import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadCartPlace, loadReminderSettings, reminderText, saveReminderSettings, type ReminderSettings } from '../../api/carts'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SaveBar } from '../common/SaveBar'
import { SectionCard } from '../common/SectionCard'
import { Switch } from '../common/Switch'
import { TextField } from '../common/TextField'
import { stateOfError, useLoad } from '../common/useLoad'
import { useFeedback } from '../shell/Feedback'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import type { CartsAccess } from './access'
import { consentNoteOf } from './cartText'
import { draftOf, draftProblem, inputOf, minimumOf, sameDraft, stepLocked, stepProblems, type ReminderDraft } from './reminderDraft'
import { ReminderRule } from './ReminderRule'
import { ReminderStepCard } from './ReminderStepCard'
import { TestReminderSheet } from './TestReminderSheet'

type Props = { access: CartsAccess; client: ApiClient; onDirty: (dirty: boolean) => void; onSaved: () => void }

const loadAll = async (client: ApiClient) => {
  const [settings, place] = await Promise.all([loadReminderSettings(client), loadCartPlace(client)])
  const currency = settings?.minimum?.currency ?? place.currency
  // A guessed currency would save the minimum in the wrong money, so a store without one is told it couldn't load.
  if (!settings || !currency) throw new Error('reminder settings missing')
  return { settings, currency, country: place.country }
}

// The reminder settings (Carts › Reminders; FIRST-RELEASE (store) §9): the switch for sending by themselves, up to three steps, and who gets reminded,
// saved as one over the revision read. Staff and a read-only store see every value with nothing to change.
export function RemindersPane({ access, client, onDirty, onSaved }: Props) {
  const loaded = useLoad(() => loadAll(client), [client])
  if (loaded.state.status === 'ready') return <RemindersForm client={client} access={access} data={loaded.state.data} onReload={loaded.reload} onDirty={onDirty} onSaved={onSaved} />
  return (
    <ShellScreen label={t('carts.reminders.screen')} onRetry={loaded.reload} {...(loaded.state.status === 'error' ? { state: stateOfError(loaded.state.error) } : {})}>
      <Skeleton />
    </ShellScreen>
  )
}

type FormProps = { client: ApiClient; access: CartsAccess; data: { settings: ReminderSettings; currency: string; country: string | null }; onReload: () => void; onDirty: (dirty: boolean) => void; onSaved: () => void }

function RemindersForm({ client, access, data, onReload, onDirty, onSaved }: FormProps) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const { currency, country } = data
  const [settings, setSettings] = useState(data.settings)
  const [draft, setDraft] = useState(() => draftOf(data.settings))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)

  const saved = draftOf(settings)
  const dirty = !sameDraft(draft, saved)
  useEffect(() => onDirty(dirty), [dirty, onDirty])

  const automatic = settings.level === 'automatic'
  const problems = stepProblems(draft.steps, automatic)
  const minimumBad = minimumOf(draft, currency) === 'invalid'
  const set = (patch: Partial<ReminderDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const setStep = (index: number, patch: Partial<ReminderDraft['steps'][number]>) => set({ steps: draft.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)) })
  const consent = consentNoteOf(country)
  const sendsByHand = !draft.enabled || settings.level === 'youSend'

  const save = async () => {
    const problem = draftProblem(draft, currency, automatic)
    if (problem) {
      setFailure(problem.kind === 'minimum' ? t('carts.reminders.errors.minimum') : t(`carts.reminders.errors.${problem.problem}`, { n: problem.step.position, subject: reminderText.subject, body: reminderText.body }))
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      const input = inputOf(draft, currency)
      const revision = await saveReminderSettings(client, input, settings.revision)
      const next = { ...settings, ...input, revision }
      setSettings(next)
      setDraft(draftOf(next))
      feedback.toast({ message: t(draft.enabled && automatic ? 'carts.reminders.savedTimings' : 'carts.reminders.saved') })
      onSaved()
    } catch (error) {
      setStale(isApiError(error, 'STALE_REVISION'))
      setFailure(errorMessage(error, 'carts'))
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setDraft(saved)
    setFailure(null)
    setStale(false)
  }

  return (
    <View style={styles.root}>
      <ShellScreen label={t('carts.reminders.screen')} onRetry={onReload}>
        <View style={styles.content}>
          {access.readOnly ? <Notice text={t('carts.readOnly')} /> : null}
          {access.viewOnly ? <Notice text={t('carts.viewOnly')} /> : null}
          {failure ? <Notice kind="error" text={failure} /> : null}
          {stale ? <Button kind="secondary" label={t('carts.reminders.reload')} onPress={onReload} /> : null}

          <SectionCard title={t('carts.reminders.auto')} sub={settings.level === 'youSend' ? t('carts.reminders.autoYouSend') : t(draft.enabled ? (automatic ? 'carts.reminders.autoOn' : 'carts.reminders.autoOne') : 'carts.reminders.autoOff')}>
            {settings.level === 'youSend' ? null : <Switch label={t('carts.reminders.auto')} value={draft.enabled} disabled={!access.canEdit} onChange={(enabled) => set({ enabled })} />}
          </SectionCard>

          {draft.steps.map((step, index) => (
            <ReminderStepCard
              key={step.position}
              step={step}
              index={index}
              locked={stepLocked(index, automatic)}
              automatic={automatic}
              byHand={index === 0 && sendsByHand}
              whatsapp={country === 'IN' && automatic}
              canEdit={access.canEdit}
              problem={problems[index] ?? null}
              testBlocked={dirty}
              onChange={(patch) => setStep(index, patch)}
              onTest={() => setTesting(step.position)}
            />
          ))}

          <SectionCard title={t('carts.reminders.who')}>
            <TextField
              label={t('carts.reminders.minimum', { currency })}
              value={draft.minimum}
              onChangeText={(minimum) => set({ minimum: minimum.replace(/[^\d.,]/g, '') })}
              keyboardType="decimal-pad"
              editable={access.canEdit}
              invalid={minimumBad}
              help={minimumBad ? t('carts.reminders.errors.minimum') : t('carts.reminders.minimumHelp')}
            />
            <ReminderRule title={t('carts.reminders.rules.skipOutOfStock.title')} body={t('carts.reminders.rules.skipOutOfStock.body')} value={draft.skipOutOfStock} disabled={!access.canEdit} onChange={(skipOutOfStock) => set({ skipOutOfStock })} />
            <ReminderRule title={t('carts.reminders.rules.quietHours.title')} body={t('carts.reminders.rules.quietHours.body')} value={draft.quietHours} disabled={!access.canEdit} onChange={(quietHours) => set({ quietHours })} />
            <ReminderRule title={t('carts.reminders.rules.weeklyCap.title')} body={t('carts.reminders.rules.weeklyCap.body')} value={draft.weeklyCap} disabled={!access.canEdit} onChange={(weeklyCap) => set({ weeklyCap })} />
            <ReminderRule title={t('carts.reminders.rules.stop.title')} body={t('carts.reminders.rules.stop.body')} value disabled onChange={() => undefined} />
            <Text style={[styles.consent, { color: colors.textStrong }]}>
              <Text style={styles.bold}>{t(`carts.reminders.consent.${consent}.title`)}</Text> {t(`carts.reminders.consent.${consent}.body`)}
            </Text>
          </SectionCard>
        </View>
      </ShellScreen>
      {access.canEdit && (dirty || failure !== null) ? <SaveBar failed={failure !== null} label={saving ? t('carts.reminders.saving') : t('carts.reminders.save')} busy={saving} onDiscard={discard} onSave={() => void save()} /> : null}
      {testing !== null ? <TestReminderSheet client={client} position={testing} onClose={() => setTesting(null)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  consent: { fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '800' },
})
