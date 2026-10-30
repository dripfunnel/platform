import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useBrand } from '../../brand/BrandContext'
import { t } from '../../messages'
import { useSession } from '../../session'
import { Button } from '../common/Button'
import { LinkButton } from '../common/LinkButton'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { AuthFrame } from './AuthFrame'
import { flowDeps } from './deps'
import { GoogleButton, OrWithEmail } from './GoogleButton'
import { GoogleCancelled, googleClients, googleIdToken, GoogleUnavailable } from './google'
import { failureOf, startGoogleSignIn, startSignIn, type NextScreen } from './signInFlow'

export function SignInScreen() {
  const router = useRouter()
  const state = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const notice = state.status === 'signedOut' && state.notice ? t(`auth.notice.${state.notice}`) : null
  // Only while the partner's Google client is on and this build carries its clients (CONFIGURATION.md §2).
  const { brand } = useBrand()
  const clients = brand?.googleSignIn ? googleClients() : null

  const go = (next: NextScreen) => {
    if (next === 'second-factor') router.push('/two-step')
    if (next === 'enrol') router.push('/enrol')
  }

  const withGoogle = async () => {
    if (!clients) return
    setGoogleBusy(true)
    setError(null)
    try {
      go(await startGoogleSignIn(flowDeps(), await googleIdToken(clients)))
    } catch (failed) {
      if (failed instanceof GoogleCancelled) setError(t('auth.googleCancelled'))
      else if (failed instanceof GoogleUnavailable) setError(t('auth.googleUnavailable'))
      else {
        const failure = failureOf(failed, 'google')
        if (failure.locked !== null) router.push({ pathname: '/locked', params: { minutes: String(failure.locked) } })
        else setError(failure.message)
      }
    } finally {
      setGoogleBusy(false)
    }
  }

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.missingFields'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      go(await startSignIn(flowDeps(), email, password))
    } catch (failed) {
      const failure = failureOf(failed, 'signIn')
      if (failure.locked !== null) router.push({ pathname: '/locked', params: { minutes: String(failure.locked) } })
      else setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title={t('auth.signInTitle')} sub={t('auth.signInSub')}>
      {error ? <Notice kind="error" text={error} /> : notice ? <Notice text={notice} /> : null}
      {clients && (
        <>
          <GoogleButton onPress={() => void withGoogle()} busy={googleBusy} />
          <OrWithEmail />
        </>
      )}
      <TextField label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder={t('auth.emailPlaceholder')} invalid={error !== null} returnKeyType="next" />
      <TextField label={t('auth.password')} value={password} onChangeText={setPassword} secret autoComplete="current-password" textContentType="password" invalid={error !== null} returnKeyType="go" onSubmitEditing={() => void submit()} />
      <LinkButton label={t('auth.forgotLink')} onPress={() => router.push('/forgot-password')} />
      <Button label={t('auth.signInButton')} onPress={() => void submit()} busy={busy} />
    </AuthFrame>
  )
}
