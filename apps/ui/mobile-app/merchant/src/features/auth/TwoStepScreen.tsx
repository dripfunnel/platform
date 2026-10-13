import { Redirect, useRouter } from 'expo-router'
import { useState } from 'react'
import { t } from '../../messages'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { AuthFrame } from './AuthFrame'
import { flowDeps } from './deps'
import { usePending } from './pending'
import { failureOf, resendCode, submitCode } from './signInFlow'
import { useCountdown } from './useCountdown'

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6)

// The second step: the 6-digit code from the authenticator app, or texted to the person's own number (ACCESS.md §4).
export function TwoStepScreen() {
  const router = useRouter()
  const pending = usePending()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, restart] = useCountdown(30)

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

  const sendAgain = async () => {
    setError(null)
    try {
      await resendCode(flowDeps())
      setInfo(t('auth.resent'))
      restart()
    } catch (failed) {
      fail(failed)
    }
  }

  const sub = pending.method === 'sms' && pending.hint ? t('auth.twoStepSms', { hint: pending.hint }) : t('auth.twoStepApp')

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
        help={pending.method === 'sms' && wait > 0 ? t('auth.resendWait', { seconds: wait }) : undefined}
      />
      {pending.method === 'sms' && wait === 0 ? <Button kind="secondary" label={t('auth.resend')} onPress={() => void sendAgain()} /> : null}
      <Button label={t('auth.verifyButton')} onPress={() => void submit()} busy={busy} />
      <Button kind="secondary" label={t('auth.useBackup')} onPress={() => router.push('/backup-code')} />
    </AuthFrame>
  )
}
