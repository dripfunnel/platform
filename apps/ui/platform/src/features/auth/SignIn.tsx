// States (?state=): wrong, code, wrongCode, expiredCode, locked, forgot, sent, expired,
// notConnected. ?outcome=expired is the Worker's real result (ACCESS §4) and is read everywhere.
import { parseScreenState, useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useReducer, useState } from 'react'
import { lockMinutes, requestPasswordReset, safeNext, signIn, verifySecondFactor, type AuthCode } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import './auth.css'
import { AuthFrame } from './AuthFrame'
import { credentialsView, signInOutcomes, signInReducer, signInStates, type SignInState, type SignInView } from './authStates'
import { CodeField } from './CodeField'

const words = messages.signIn

export interface SignInSearch {
  next?: string | undefined
  outcome?: string | undefined
}

const emailLooksValid = (email: string) => /.+@.+\..+/.test(email)

// Where a harness state puts the card: the step, the message and whether the code is locked.
const forcedView = (state: SignInState): SignInView => {
  switch (state) {
    case 'wrong':
      return { ...credentialsView, error: words.credentials.refused }
    case 'notConnected':
      return { ...credentialsView, error: messages.auth.notConnected }
    case 'code':
      return { ...credentialsView, step: 'code' }
    case 'wrongCode':
      return { ...credentialsView, step: 'code', error: fill(words.code.wrong, { tries: fill(words.code.tries, { count: '3' }) }) }
    case 'expiredCode':
      return { ...credentialsView, step: 'code', error: words.code.expired }
    case 'locked':
      return { ...credentialsView, step: 'code', error: fill(words.code.locked, { minutes: String(lockMinutes) }), locked: true }
    case 'forgot':
      return { ...credentialsView, step: 'forgot' }
    case 'sent':
      return { ...credentialsView, step: 'sent' }
    case 'expired':
      return { ...credentialsView, expired: true }
  }
}

const startView = (forced: SignInState | null, outcome: string | null): SignInView =>
  forced ? forcedView(forced) : { ...credentialsView, expired: outcome === 'expired' }

const refusalWords = (code: AuthCode, triesLeft?: number, minutes?: number): string => {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return words.credentials.refused
    case 'WRONG_CODE':
      return fill(words.code.wrong, { tries: triesLeft === 1 ? words.code.tryOne : fill(words.code.tries, { count: String(triesLeft ?? 0) }) })
    case 'CODE_EXPIRED':
      return words.code.expired
    case 'LOCKED':
      return fill(words.code.locked, { minutes: String(minutes ?? lockMinutes) })
    default:
      return messages.auth.notConnected
  }
}

export const SignIn = ({ search }: { search: SignInSearch }) => {
  const navigate = useNavigate()
  const forced = useScreenState(signInStates, harnessEnabled)
  const outcome = parseScreenState(search.outcome, signInOutcomes)
  const [view, dispatch] = useReducer(signInReducer, startView(forced, outcome))
  const { step, error, locked, expired } = view
  const setError = (next: string | null) => dispatch({ type: 'error', error: next })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const emailId = useId()
  const passwordId = useId()
  const hintId = useId()

  useEffect(() => {
    dispatch({ type: 'reset', view: startView(forced, outcome) })
  }, [forced, outcome])

  const finish = () => void navigate({ href: safeNext(search.next, window.location.origin) })

  const submitCredentials = async () => {
    if (!emailLooksValid(email) || password === '') return setError(words.credentials.missing)
    setBusy(true)
    const result = await signIn(email, password)
    setBusy(false)
    if (!result.ok) return setError(refusalWords(result.code))
    if (result.secondFactor) return dispatch({ type: 'code' })
    finish()
  }

  const submitCode = async () => {
    if (!/^\d{6}$/.test(code)) return setError(words.code.incomplete)
    setBusy(true)
    const result = await verifySecondFactor(code)
    setBusy(false)
    setCode('')
    if (!result.ok) {
      const message = refusalWords(result.code, result.triesLeft, result.minutes)
      return dispatch(result.code === 'LOCKED' ? { type: 'locked', error: message } : { type: 'error', error: message })
    }
    finish()
  }

  const submitForgot = async () => {
    if (!emailLooksValid(email)) return setError(words.forgot.invalid)
    setBusy(true)
    await requestPasswordReset()
    setBusy(false)
    dispatch({ type: 'sent' })
  }

  const backToCredentials = () => {
    dispatch({ type: 'back' })
    setCode('')
    setPassword('')
  }

  const stepWords = step === 'credentials' && expired ? words.expired : words[step]
  const title = stepWords.title
  const body = step === 'sent' ? fill(words.sent.body, { email: email || words.sent.fallback }) : stepWords.body

  return (
    <AuthFrame title={title} body={body} error={error} footer={step === 'credentials' ? messages.auth.footer : undefined}>
      {step === 'credentials' && (
        <form
          className="df-sign-in-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submitCredentials()
          }}
        >
          <div className="df-field">
            <label htmlFor={emailId}>{words.credentials.email}</label>
            <input id={emailId} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="df-field">
            <label htmlFor={passwordId}>{words.credentials.password}</label>
            <input id={passwordId} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={busy}>
            {words.credentials.continue}
          </button>
          <button type="button" className="df-sign-in-link" onClick={() => dispatch({ type: 'forgot' })}>
            {words.credentials.forgot}
          </button>
        </form>
      )}
      {step === 'code' && (
        <form
          className="df-sign-in-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submitCode()
          }}
        >
          <CodeField value={code} onChange={setCode} disabled={locked} />
          <p id={hintId} className="df-field-hint">
            {words.code.hint}
          </p>
          <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={locked || busy || !/^\d{6}$/.test(code)} aria-describedby={locked ? undefined : hintId}>
            {words.code.verify}
          </button>
          <button type="button" className="df-sign-in-link" onClick={backToCredentials}>
            {words.code.differentAccount}
          </button>
        </form>
      )}
      {step === 'forgot' && (
        <form
          className="df-sign-in-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submitForgot()
          }}
        >
          <div className="df-field">
            <label htmlFor={emailId}>{words.credentials.email}</label>
            <input id={emailId} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={busy}>
            {words.forgot.send}
          </button>
          <button type="button" className="df-sign-in-link" onClick={backToCredentials}>
            {words.forgot.back}
          </button>
        </form>
      )}
      {step === 'sent' && (
        <button type="button" className="df-sign-in-link" onClick={backToCredentials}>
          {words.forgot.back}
        </button>
      )}
    </AuthFrame>
  )
}
