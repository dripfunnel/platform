// States (?state=): invalid, done. The prototype has no screen for the reset link, so this is the
// invitation page's password step (AcceptInvite.tsx), FIRST-RELEASE.md §3.
import { useScreenState } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { resetPassword } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import './auth.css'
import { AuthFrame } from './AuthFrame'
import { resetPasswordStates } from './authStates'

const words = messages.resetPassword

// The API's rule (apps/api src/apis/platform/invitations.ts), checked here only to word it sooner.
const minPasswordLength = 10

export const ResetPassword = ({ search }: { search: { token?: string | undefined } }) => {
  const forced = useScreenState(resetPasswordStates, harnessEnabled)
  const [outcome, setOutcome] = useState<'invalid' | 'done' | null>(forced)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const passwordId = useId()
  const passwordHintId = useId()

  useEffect(() => {
    setOutcome(forced)
    setError(null)
    setPassword('')
  }, [forced, search.token])

  const submit = async () => {
    if (password.length < minPasswordLength) return setError(words.weak)
    setBusy(true)
    const result = await resetPassword(search.token, password)
    setBusy(false)
    if (result.ok) return setOutcome('done')
    if (result.code === 'RESET_INVALID') return setOutcome('invalid')
    setError(result.code === 'WEAK_PASSWORD' ? words.weak : result.code === 'RATE_LIMITED' ? messages.auth.rateLimited : messages.auth.notConnected)
  }

  if (outcome || !search.token) {
    const shown = outcome === 'done' ? words.done : words.invalid
    return (
      <AuthFrame title={shown.title} body={shown.body}>
        <Link to="/sign-in" className="df-button df-button--primary df-sign-in-submit">
          {messages.auth.goToSignIn}
        </Link>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={words.title} body={words.body} error={error}>
      <form
        className="df-sign-in-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="df-field">
          <label htmlFor={passwordId}>{words.password}</label>
          <input id={passwordId} type="password" autoComplete="new-password" aria-describedby={passwordHintId} value={password} onChange={(event) => setPassword(event.target.value)} />
          <p id={passwordHintId} className="df-field-hint">
            {words.passwordHint}
          </p>
        </div>
        <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={busy}>
          {words.save}
        </button>
      </form>
    </AuthFrame>
  )
}
