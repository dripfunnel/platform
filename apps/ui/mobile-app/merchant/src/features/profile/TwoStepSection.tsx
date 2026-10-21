import { useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { confirmSecondFactor, regenerateBackupCodes, startSecondFactor, turnOffSecondFactor, type Profile, type SecondFactorMethod } from '../../api/profile'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { BackupCodes } from '../common/BackupCodes'
import { Button } from '../common/Button'
import { LinkButton } from '../common/LinkButton'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { SectionCard } from '../common/SectionCard'

type Flow =
  | { step: 'idle' }
  | { step: 'off' }
  | { step: 'pick'; method: SecondFactorMethod; switching: boolean }
  | { step: 'verify'; method: SecondFactorMethod; switching: boolean; secret: string | null; uri: string | null; hint: string | null }
  | { step: 'codes'; codes: string[] }

const methodName = (method: SecondFactorMethod) => (method === 'app' ? t('profile.methodApp') : t('profile.methodSms'))

// Two-step sign-in as the prototype's My profile draws it: set up, switch the method, make new backup codes, turn off.
// Every start and every off needs the password, and the backup codes are shown once (ACCESS.md §4).
export function TwoStepSection({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const { colors, radii } = useTheme()
  const [flow, setFlow] = useState<Flow>({ step: 'idle' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { method, required, backupCodesLeft } = profile.twoFactor
  const left = backupCodesLeft ?? 0

  const reset = () => {
    setFlow({ step: 'idle' })
    setPassword('')
    setCode('')
    setError(null)
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failed) {
      setError(errorMessage(failed, 'profile'))
    } finally {
      setBusy(false)
    }
  }

  const start = (picked: SecondFactorMethod, switching: boolean) =>
    run(async () => {
      const step = await startSecondFactor(sessionClient(), picked, password)
      setPassword('')
      setFlow({ step: 'verify', method: picked, switching, secret: step.secret, uri: step.uri, hint: step.hint })
    })

  const verify = (current: Extract<Flow, { step: 'verify' }>) =>
    run(async () => {
      const step = await confirmSecondFactor(sessionClient(), current.method, code)
      onChanged()
      setCode('')
      if (step.backupCodes) setFlow({ step: 'codes', codes: step.backupCodes })
      else {
        reset()
        setDone(current.switching ? t('profile.switched', { method: methodName(current.method) }) : t('profile.turnedOn'))
      }
    })

  const turnOff = () =>
    run(async () => {
      await turnOffSecondFactor(sessionClient(), password)
      onChanged()
      reset()
      setDone(t('profile.turnedOff'))
    })

  const makeNewCodes = () =>
    Alert.alert(t('profile.newCodesTitle'), t('profile.newCodesBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.newCodes'), onPress: () => void run(async () => setFlow({ step: 'codes', codes: await regenerateBackupCodes(sessionClient()) })) },
    ])

  const why = required ? t('profile.twoStepWhyOwner') : t('profile.twoStepWhyOther')
  const pill = method ? t('profile.pillOn') : required ? t('profile.pillNeeds') : t('profile.pillOff')
  const pillColors = method ? { bg: colors.successSurface, fg: colors.success } : required ? { bg: colors.warningSurface, fg: colors.warning } : { bg: colors.neutralSurface, fg: colors.neutral }

  return (
    <SectionCard title={t('profile.twoStepTitle')} sub={why}>
      <Text style={[styles.pill, { backgroundColor: pillColors.bg, color: pillColors.fg }]}>{pill}</Text>
      {error ? <Notice kind="error" text={error} /> : done && flow.step === 'idle' ? <Notice kind="success" text={done} /> : null}

      {flow.step === 'idle' && method ? (
        <>
          <View style={[styles.rows, { borderColor: colors.border, borderRadius: radii.button }]}>
            <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>{methodName(method)}</Text>
                <Text style={[styles.rowSub, { color: colors.muted }]}>{method === 'app' ? t('profile.methodAppSub') : t('profile.methodSmsSub')}</Text>
              </View>
              <LinkButton label={method === 'app' ? t('profile.useSms') : t('profile.useApp')} onPress={() => setFlow({ step: 'pick', method: method === 'app' ? 'sms' : 'app', switching: true })} />
            </View>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profile.backupCodes')}</Text>
                <Text style={[styles.rowSub, { color: left <= 3 ? colors.danger : colors.muted }]}>{left <= 3 ? t('profile.backupSoon', { count: left }) : t('profile.backupLeft', { count: left })}</Text>
              </View>
              <LinkButton label={t('profile.newCodes')} onPress={makeNewCodes} />
            </View>
          </View>
          {!required ? <LinkButton danger label={t('profile.turnOff')} onPress={() => setFlow({ step: 'off' })} /> : null}
        </>
      ) : null}

      {flow.step === 'idle' && !method ? <Button label={t('profile.turnOn')} onPress={() => setFlow({ step: 'pick', method: 'app', switching: false })} /> : null}

      {flow.step === 'off' ? (
        <>
          <Notice kind="error" text={`${t('profile.turnOffTitle')} ${t('profile.turnOffBody')}`} />
          <TextField label={t('profile.stepPassword')} value={password} onChangeText={setPassword} secret autoComplete="current-password" textContentType="password" help={t('profile.stepPasswordHelp')} />
          <Button label={t('profile.turnOffConfirm')} onPress={() => void turnOff()} busy={busy} disabled={!password} saves />
          <Button kind="secondary" label={t('common.cancel')} onPress={reset} />
        </>
      ) : null}

      {flow.step === 'pick' ? (
        <>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profile.pickTitle')}</Text>
          {(['app', 'sms'] as const).map((option) => {
            const unavailable = option === 'sms' && !profile.phone
            const selected = flow.method === option
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: unavailable }}
                disabled={unavailable}
                onPress={() => setFlow({ ...flow, method: option })}
                style={[styles.option, { borderColor: selected ? colors.focus : colors.fieldBorder, borderWidth: selected ? 2 : 1, borderRadius: radii.button, backgroundColor: colors.surface, opacity: unavailable ? 0.55 : 1 }]}
              >
                <View style={[styles.dot, { borderColor: selected ? colors.focus : colors.muted, borderWidth: selected ? 5 : 1.5 }]} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{methodName(option)}</Text>
                  <Text style={[styles.rowSub, { color: colors.muted }]}>{option === 'app' ? t('profile.pickAppSub') : unavailable ? t('profile.pickSmsNone') : t('profile.pickSmsSub')}</Text>
                </View>
              </Pressable>
            )
          })}
          <TextField label={t('profile.stepPassword')} value={password} onChangeText={setPassword} secret autoComplete="current-password" textContentType="password" help={t('profile.stepPasswordHelp')} />
          <Button label={t('profile.next')} onPress={() => void start(flow.method, flow.switching)} busy={busy} disabled={!password} saves />
          <Button kind="secondary" label={t('common.cancel')} onPress={reset} />
        </>
      ) : null}

      {flow.step === 'verify' ? (
        <>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{flow.method === 'app' ? t('profile.verifyAppTitle') : t('profile.verifySmsTitle', { hint: flow.hint ?? '' })}</Text>
          {flow.method === 'app' && flow.secret ? (
            <View style={[styles.key, { backgroundColor: colors.page, borderColor: colors.border, borderRadius: radii.button }]}>
              <Text style={[styles.rowSub, { color: colors.muted }]}>{t('profile.setupKey')}</Text>
              <Text selectable style={[styles.secret, { color: colors.text }]}>
                {flow.secret.replace(/(.{4})/g, '$1 ').trim()}
              </Text>
              {flow.uri ? <Button kind="secondary" label={t('profile.openAuthenticator')} onPress={() => void Linking.openURL(flow.uri ?? '').catch(() => undefined)} /> : null}
            </View>
          ) : null}
          <TextField label={t('profile.sixDigitCode')} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} code keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
          <Button label={t('profile.verify')} onPress={() => void verify(flow)} busy={busy} disabled={code.length !== 6} saves />
          <Button kind="secondary" label={t('common.cancel')} onPress={reset} />
        </>
      ) : null}

      {flow.step === 'codes' ? (
        <>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profile.codesTitle')}</Text>
          <Text style={[styles.rowSub, { color: colors.muted }]}>{t('profile.codesSub')}</Text>
          <BackupCodes codes={flow.codes} shareLabel={t('profile.shareCodes')} />
          <Button
            label={t('profile.codesSaved')}
            onPress={() => {
              reset()
              onChanged()
            }}
          />
        </>
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  rows: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 13, lineHeight: 19 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56 },
  dot: { width: 20, height: 20, borderRadius: 10 },
  key: { borderWidth: 1, padding: 12, gap: 8 },
  secret: { fontFamily: 'monospace', fontSize: 16, letterSpacing: 1 },
})
