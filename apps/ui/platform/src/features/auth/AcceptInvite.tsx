// States (?state=): expired, used, replaced, invalid, member, twoFactor, required. The token
// in the address (`/accept-invite?token=`) drives the fixture the same way (api/auth.ts).
import { useScreenState } from '@dripfunnel/shared/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { acceptInvitation, enrolSecondFactor, skipSecondFactor, type AuthCode, type invitation } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import './auth.css'
import { AuthFrame } from './AuthFrame'
import { acceptInviteStates, inviteToken } from './authStates'
import { CodeField } from './CodeField'

const words = messages.acceptInvite

export interface AcceptInviteProps {
  search: { token?: string | undefined }
  loaded: Awaited<ReturnType<typeof invitation>>
}

type LinkProblem = 'expired' | 'used' | 'replaced' | 'invalid'

const linkProblems: Partial<Record<AuthCode, LinkProblem>> = {
  INVITATION_EXPIRED: 'expired',
  INVITATION_USED: 'used',
  INVITATION_REPLACED: 'replaced',
  INVITATION_INVALID: 'invalid',
}

export const AcceptInvite = ({ search, loaded }: AcceptInviteProps) => {
  const navigate = useNavigate()
  const forced = useScreenState(acceptInviteStates, harnessEnabled)
  const token = inviteToken(forced, search.token)
  const found = loaded.ok ? loaded.invitation : null
  // A link can expire or be replaced between loading and Continue; that refusal is a link problem too.
  const [lateProblem, setLateProblem] = useState<LinkProblem | null>(null)
  const problem: LinkProblem | 'notConnected' | null = lateProblem ?? (loaded.ok ? null : (linkProblems[loaded.code] ?? 'notConnected'))
  const [step, setStep] = useState<'form' | 'twoFactor'>(forced === 'twoFactor' || forced === 'required' ? 'twoFactor' : 'form')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const nameId = useId()
  const passwordId = useId()
  const passwordHintId = useId()

  useEffect(() => {
    setStep(forced === 'twoFactor' || forced === 'required' ? 'twoFactor' : 'form')
    setError(null)
    setLateProblem(null)
    setName('')
    setPassword('')
    setCode('')
  }, [forced, token])

  const submitForm = async () => {
    if (name.trim() === '' || password.length < 10) return setError(words.weak)
    setBusy(true)
    const result = await acceptInvitation(token, name, password)
    setBusy(false)
    if (!result.ok) {
      const late = linkProblems[result.code]
      if (late) return setLateProblem(late)
      return setError(result.code === 'WEAK_PASSWORD' ? words.weak : messages.auth.notConnected)
    }
    setError(null)
    setStep('twoFactor')
  }

  const finish = () => void navigate({ to: '/dashboard' })

  const submitCode = async () => {
    setBusy(true)
    const result = await enrolSecondFactor(code)
    setBusy(false)
    if (!result.ok) return setError(result.code === 'WRONG_CODE' ? words.twoFactor.wrong : messages.auth.notConnected)
    finish()
  }

  const skip = async () => {
    setBusy(true)
    const result = await skipSecondFactor(token)
    setBusy(false)
    if (!result.ok) return setError(words.twoFactor.required)
    finish()
  }

  if (problem) {
    const linkWords = problem === 'notConnected' ? { title: words.links.invalid.title, body: messages.auth.notConnected } : words.links[problem]
    return (
      <AuthFrame title={linkWords.title} body={linkWords.body}>
        <Link to="/sign-in" className="df-button df-button--primary df-sign-in-submit">
          {messages.auth.goToSignIn}
        </Link>
      </AuthFrame>
    )
  }

  if (!found) return null

  if (step === 'twoFactor') {
    const required = found.secondFactorRequired
    return (
      <AuthFrame title={words.twoFactor.title} body={required ? words.twoFactor.bodyRequired : words.twoFactor.bodyOptional} error={error}>
        <p className="df-auth-step">{words.twoFactor.step}</p>
        <div className="df-auth-enrol">
          <div className="df-auth-qr" role="img" aria-label={words.twoFactor.qrLabel}>
            {words.twoFactor.qrPlaceholder}
          </div>
          <div className="df-auth-key">
            <span>{words.twoFactor.keyLabel}</span>
            <code>{found.secretKey}</code>
          </div>
        </div>
        <form
          className="df-sign-in-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submitCode()
          }}
        >
          <CodeField value={code} onChange={setCode} />
          <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={busy || !/^\d{6}$/.test(code)}>
            {words.twoFactor.finish}
          </button>
          {!required && (
            <button type="button" className="df-sign-in-link" onClick={() => void skip()} disabled={busy}>
              {words.twoFactor.skip}
            </button>
          )}
        </form>
      </AuthFrame>
    )
  }

  const body = fill(found.role === 'partner-owner' ? words.bodyOwner : words.bodyMember, { partner: found.partner, inviter: found.invitedBy })
  return (
    <AuthFrame title={fill(words.title, { partner: found.partner })} body={body} error={error}>
      <dl className="df-auth-summary">
        <div>
          <dt>{words.partner}</dt>
          <dd>
            <strong>{found.partner}</strong>
          </dd>
        </div>
        <div>
          <dt>{words.role}</dt>
          <dd>{messages.shell.roles[found.role]}</dd>
        </div>
        <div>
          <dt>{words.email}</dt>
          <dd>{found.email}</dd>
        </div>
      </dl>
      <p className="df-auth-summary-note">{fill(words.invitedBy, { inviter: found.invitedBy })}</p>
      <form
        className="df-sign-in-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submitForm()
        }}
      >
        <div className="df-field">
          <label htmlFor={nameId}>{words.name}</label>
          <input id={nameId} type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="df-field">
          <label htmlFor={passwordId}>{words.password}</label>
          <input id={passwordId} type="password" autoComplete="new-password" aria-describedby={passwordHintId} value={password} onChange={(event) => setPassword(event.target.value)} />
          <p id={passwordHintId} className="df-field-hint">
            {words.passwordHint}
          </p>
        </div>
        <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={busy}>
          {words.continue}
        </button>
      </form>
    </AuthFrame>
  )
}
