import { useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { isRefusal, resetPassword } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { resetStates } from './authStates'
import { AuthFrame } from './AuthFrame'
import { NewPasswordField, PasswordField, Primary, Secondary } from './fields'
import { refusalText } from './refusals'

const words = messages.auth

// PortalAuth's reset view: a new password from the emailed link, which signs out everywhere else and
// then signs in here as far as two-step sign-in allows (ACCESS.md §4). ?state= per authStates.ts.
export const ResetPassword = ({ token }: { token: string | undefined }) => {
  const navigate = useNavigate()
  const forced = useScreenState(resetStates, harnessEnabled)
  const [password, setPassword] = useState(forced === 'mismatch' ? 'Northwind-2026' : '')
  const [again, setAgain] = useState(forced === 'mismatch' ? 'Northwind-2025' : '')
  const usable = forced ? forced !== 'linkInvalid' : Boolean(token)
  const [error, setError] = useState<string | null>(usable ? null : words.reset.invalid)
  const [dead, setDead] = useState(!usable)
  const [busy, setBusy] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    if (password.length < 10) return setError(words.reset.short)
    if (password !== again) return setError(words.reset.mismatch)
    setBusy(true)
    void resetPassword(token, password).then((answer) => {
      setBusy(false)
      if (isRefusal(answer)) {
        setDead(answer.code === 'RESET_INVALID')
        return setError(answer.code === 'RESET_INVALID' ? words.reset.invalid : answer.code === 'WEAK_PASSWORD' ? words.reset.short : refusalText(answer))
      }
      if (answer.step === 'done') return void navigate({ to: '/stores', search: { next: '/home' } })
      // A second factor or its set-up still stands between the new password and the store.
      void navigate({ to: '/sign-in', search: answer.step === 'enrol' ? { step: 'enrol', next: '/home' } : { step: 'second-factor', method: answer.method, next: '/home' } })
    })
  }

  return (
    <AuthFrame panel="reset" title={words.reset.title} sub={words.reset.sub} notice={error ? { text: error, tone: 'error' } : null}>
      {dead ? (
        <Secondary onClick={() => void navigate({ to: '/sign-in', search: { view: 'forgot' } })}>{words.reset.askAgain}</Secondary>
      ) : (
        <form className="df-portal-auth-form" onSubmit={submit} noValidate>
          <NewPasswordField label={words.fields.newPassword} value={password} onValue={setPassword} />
          <PasswordField label={words.fields.newPasswordAgain} autoComplete="new-password" value={again} onValue={setAgain} invalid={again !== '' && again !== password} help={again !== '' && again !== password ? words.reset.mismatch : undefined} helpWeak />
          <Primary busy={busy}>{words.reset.primary}</Primary>
        </form>
      )}
    </AuthFrame>
  )
}
