import { useRouter } from 'expo-router'
import { useState } from 'react'
import { requestPasswordReset } from '../../api/auth'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { restOptions } from '../../session'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { AuthFrame } from './AuthFrame'
import { useCountdown } from './useCountdown'

const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// The app asks for the email and nothing more: the link in it opens the web portal, where the new password is
// chosen, and the person then signs in here (decided 2026-10-09, #490).
export function ForgotPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, restart] = useCountdown(30)

  const send = async (again: boolean) => {
    if (!looksLikeEmail.test(email.trim())) {
      setError(t('auth.forgotEmailInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(restOptions(), email)
      setSent(true)
      if (again) setInfo(t('auth.forgotSentAgainDone'))
      restart()
    } catch (failed) {
      setError(errorMessage(failed))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthFrame title={t('auth.forgotSentTitle')} sub={t('auth.forgotSentSub', { email: email.trim() })} back>
        {info ? <Notice kind="success" text={info} /> : null}
        {error ? <Notice kind="error" text={error} /> : null}
        <Button label={t('auth.forgotSentBack')} onPress={() => router.replace('/sign-in')} />
        <Button kind="secondary" label={wait > 0 ? `${t('auth.forgotSentAgain')} (${wait}s)` : t('auth.forgotSentAgain')} onPress={() => void send(true)} disabled={wait > 0} busy={busy} />
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={t('auth.forgotTitle')} sub={t('auth.forgotSub')} back>
      {error ? <Notice kind="error" text={error} /> : null}
      <TextField label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder={t('auth.emailPlaceholder')} invalid={error !== null} />
      <Button label={t('auth.forgotSend')} onPress={() => void send(false)} busy={busy} />
    </AuthFrame>
  )
}
