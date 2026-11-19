import { Redirect, useRouter } from 'expo-router'
import { useState } from 'react'
import type { CodeChannel } from '../../api/auth'
import { t } from '../../messages'
import { Button } from '../common/Button'
import { CodeResend } from '../common/CodeResend'
import { resendWaitSeconds } from '../common/codeSend'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { AuthFrame } from './AuthFrame'
import { flowDeps } from './deps'
import { usePending } from './pending'
import { failureOf, sendSignInCode, submitCode } from './signInFlow'
import { useCountdown } from './useCountdown'

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6)

// The second step: the 6-digit code from the authenticator app, or sent to the person's own number by WhatsApp or SMS (ACCESS.md §4).
export function TwoStepScreen() {
  const router = useRouter()
  const pending = usePending()
  const opened = pending?.step === 'second-factor' ? pending : null
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(opened?.opening?.text ?? null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [wait, restart] = useCountdown(resendWaitSeconds, opened?.sent ? resendWaitSeconds : (opened?.opening?.wait ?? 0))

  if (pending?.step !== 'second-factor') return <Redirect href="/sign-in" />

  const fail = (failed: unknown) => {
    const failure = failureOf(failed, 'code')
    if (failure.locked !== null) router.replace({ pathname: '/locked', params: { minutes: String(failure.locked) } })
    else if (failure.expired) router.replace('/sign-in')
    else setError(failure.message)
  }

  const submit = async () => {
    if (code.length !== 6) {
      setError(t('auth.codeLength'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitCode(flowDeps(), code)
    } catch (failed) {
      fail(failed)
    } finally {
      setBusy(false)
    }
  }

  const sendAgain = async (channel: CodeChannel) => {
    const before = pending.sent
    setSending(true)
    setError(null)
    setInfo(null)
    try {
      const refused = await sendSignInCode(flowDeps(), channel)
      if (refused) {
        setError(refused.text)
        if (refused.wait !== null) restart(refused.wait)
      } else {
        if (before) setInfo(t('auth.resent'))
        restart()
      }
    } catch (failed) {
      fail(failed)
    } finally {
      setSending(false)
    }
  }

  const sub = pending.method === 'app' ? t('auth.twoStepApp') : pending.sent ? t('auth.twoStepSms') : t('auth.twoStepSmsUnsent')

  return (
    <AuthFrame title={t('auth.twoStepTitle')} sub={sub} back>
      {error ? <Notice kind="error" text={error} /> : info ? <Notice kind="success" text={info} /> : null}
      <TextField
        label={t('auth.code')}
        value={code}
        onChangeText={(value) => setCode(digits(value))}
        code
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        placeholder={t('auth.codePlaceholder')}
        invalid={error !== null}
      />
      {pending.method === 'sms' ? <CodeResend sent={pending.sent} channels={pending.channels} wait={wait} busy={sending} onSend={(channel) => void sendAgain(channel)} /> : null}
      <Button label={t('auth.verifyButton')} onPress={() => void submit()} busy={busy} />
      <Button kind="secondary" label={t('auth.useBackup')} onPress={() => router.push('/backup-code')} />
    </AuthFrame>
  )
}
