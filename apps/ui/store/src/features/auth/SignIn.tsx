import { safeNext, useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { backupCodeFrom, confirmEnrolBySms, enrolBySms, isRefusal, requestPasswordReset, sendCode, signIn, useBackupCode, verifyCode, type Admitted, type AuthRefusal } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { sampleCodes, sampleEmail, sampleHint, signInStates, type SignInState } from './authStates'
import { AuthFrame } from './AuthFrame'
import { BackupCodes } from './BackupCodes'
import { CodeField, Field, Foot, PasswordField, Primary, productName, Secondary, useResendWait } from './fields'
import { refusalText } from './refusals'

const words = messages.auth

type View =
  | { kind: 'login' }
  | { kind: 'code'; method: 'app' | 'sms'; hint: string | null }
  | { kind: 'backup' }
  | { kind: 'enrol'; hint: string | null }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'locked'; minutes: number }
  | { kind: 'forgot' }
  | { kind: 'sent'; email: string }

export interface SignInProps {
  next: string | undefined
  /** Where a session already started stands: an Owner made by sign-up or an invitation sets up two-step
   *  sign-in; a reset still owes its second factor. The pending cookie is already set. */
  resume?: { step: 'enrol' } | { step: 'second-factor'; method: 'app' | 'sms' } | undefined
  /** Why the person is here: signed out, or their session expired (FIRST-RELEASE §3.3). */
  note?: 'signedOut' | 'expired' | undefined
  /** Opens on "Forgot password", as a dead reset link's "Ask for a new link" does. */
  start?: 'forgot' | undefined
}


const forcedNote = (state: SignInState | null): 'expired' | 'signedOut' | undefined => (state === 'sessionExpired' ? 'expired' : state === 'signedOut' ? state : undefined)

// Where a harness state opens the screen, and the words it shows there.
const forcedStart = (state: SignInState): { view: View; error: string | null } => {
  switch (state) {
    case 'wrong':
      return { view: { kind: 'login' }, error: refusalText({ ok: false, code: 'INVALID_CREDENTIALS' }) }
    case 'code':
      return { view: { kind: 'code', method: 'sms', hint: sampleHint }, error: null }
    case 'codeApp':
      return { view: { kind: 'code', method: 'app', hint: null }, error: null }
    case 'wrongCode':
      return { view: { kind: 'code', method: 'sms', hint: sampleHint }, error: refusalText({ ok: false, code: 'WRONG_CODE', triesLeft: 2 }) }
    case 'backup':
      return { view: { kind: 'backup' }, error: null }
    case 'enrol':
      return { view: { kind: 'enrol', hint: null }, error: null }
    case 'enrolCode':
      return { view: { kind: 'enrol', hint: sampleHint }, error: null }
    case 'codes':
      return { view: { kind: 'codes', codes: [...sampleCodes] }, error: null }
    case 'locked':
      return { view: { kind: 'locked', minutes: 15 }, error: null }
    case 'forgot':
      return { view: { kind: 'forgot' }, error: null }
    case 'sent':
      return { view: { kind: 'sent', email: sampleEmail }, error: null }
    case 'sessionExpired':
    case 'signedOut':
      return { view: { kind: 'login' }, error: null }
    case 'notConnected':
      return { view: { kind: 'login' }, error: refusalText({ ok: false, code: 'NOT_CONNECTED' }) }
    case 'rateLimited':
      return { view: { kind: 'login' }, error: refusalText({ ok: false, code: 'RATE_LIMITED' }) }
  }
}

// PortalAuth's login, tfa, backup, enrol, locked and forgot views (FIRST-RELEASE §4; ACCESS.md §4; ?state=
// per authStates.ts). Admitted, the person goes to the store chooser, which opens their one store or asks which.
export const SignIn = ({ next, note, resume, start: opening }: SignInProps) => {
  const navigate = useNavigate()
  const forced = useScreenState(signInStates, harnessEnabled)
  const start = forced ? forcedStart(forced) : null
  const [view, setView] = useState<View>(start?.view ?? (opening === 'forgot' ? { kind: 'forgot' } : resume?.step === 'enrol' ? { kind: 'enrol', hint: null } : resume?.step === 'second-factor' ? { kind: 'code', method: resume.method, hint: null } : { kind: 'login' }))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(start?.error ?? null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, startWait] = useResendWait()

  const go = (to: View) => {
    setView(to)
    setError(null)
    setInfo(null)
    setCode('')
  }
  const enter = () => void navigate({ to: '/stores', search: { next: safeNext(next, window.location.origin, '/home') } })
  const refused = (refusal: AuthRefusal) => {
    if (refusal.code === 'LOCKED') go({ kind: 'locked', minutes: refusal.minutes ?? 15 })
    else setError(refusalText(refusal))
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const admitted = async (answer: Admitted) => {
    if (answer.step === 'done') return enter()
    if (answer.step === 'enrol') return go({ kind: 'enrol', hint: null })
    if (answer.method === 'app') return go({ kind: 'code', method: 'app', hint: null })
    const sent = await sendCode()
    startWait()
    go({ kind: 'code', method: 'sms', hint: isRefusal(sent) ? null : sent.hint })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (view.kind === 'login') {
        if (!email.trim() || !password) return setError(words.signIn.missing)
        const answer = await signIn(email.trim(), password, remember)
        return isRefusal(answer) ? refused(answer) : admitted(answer)
      }
      if (view.kind === 'code') {
        if (code.length !== 6) return setError(words.secondFactor.incomplete)
        const answer = await verifyCode(code)
        return isRefusal(answer) ? refused(answer) : enter()
      }
      if (view.kind === 'backup') {
        const typed = backupCodeFrom(code)
        if (!typed) return setError(words.backup.malformed)
        const answer = await useBackupCode(typed)
        return isRefusal(answer) ? refused(answer) : enter()
      }
      if (view.kind === 'enrol') {
        if (view.hint === null) {
          const answer = await enrolBySms(phone.trim())
          if (isRefusal(answer)) return answer.code === 'INVALID_CREDENTIALS' ? setError(words.enrol.stale) : refused(answer)
          if ('hint' in answer) {
            startWait()
            setView({ kind: 'enrol', hint: answer.hint })
            setError(null)
          }
          return
        }
        if (code.length !== 6) return setError(words.secondFactor.incomplete)
        const answer = await confirmEnrolBySms(code)
        if (isRefusal(answer)) return refused(answer)
        if ('backupCodes' in answer) go({ kind: 'codes', codes: answer.backupCodes })
        return
      }
      if (view.kind === 'forgot') {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(words.forgot.invalid)
        const answer = await requestPasswordReset(email.trim())
        return isRefusal(answer) ? refused(answer) : go({ kind: 'sent', email: email.trim() })
      }
    })
  }

  useEffect(() => {
    if (!forced) return
    const next = forcedStart(forced)
    setView(next.view)
    setError(next.error)
  }, [forced])

  // A resumed SMS step texts its code once, as a fresh sign-in would.
  const texted = useRef(false)
  useEffect(() => {
    if (resume?.step !== 'second-factor' || resume.method !== 'sms' || texted.current) return
    texted.current = true
    void sendCode().then((sent) => {
      startWait()
      if (!isRefusal(sent)) setView({ kind: 'code', method: 'sms', hint: sent.hint })
    })
  }, [resume, startWait])

  const resendSignIn = () =>
    void run(async () => {
      const sent = await sendCode()
      if (isRefusal(sent)) return setError(refusalText(sent))
      startWait()
      setInfo(words.secondFactor.sent)
    })
  const shownNote = note ?? forcedNote(forced)
  const notice = error ? { text: error, tone: 'error' as const } : info ? { text: info, tone: 'info' as const } : view.kind === 'login' && shownNote ? { text: words.signIn[shownNote], tone: 'info' as const } : null

  switch (view.kind) {
    case 'login':
      return (
        <AuthFrame panel="in" title={words.signIn.title} sub={words.signIn.sub} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <Field label={words.fields.email} type="email" autoComplete="email" placeholder={words.fields.emailPlaceholder} value={email} onValue={setEmail} invalid={error !== null} />
            <PasswordField label={words.fields.password} autoComplete="current-password" value={password} onValue={setPassword} invalid={error !== null} aside={{ label: words.signIn.forgot, onClick: () => go({ kind: 'forgot' }) }} />
            <label className="df-auth-check">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              {words.fields.remember}
            </label>
            <Primary busy={busy}>{words.signIn.primary}</Primary>
          </form>
          <Foot text={fill(words.signIn.foot, { product: productName() })} link={words.signIn.footLink} onClick={() => void navigate({ to: '/sign-up' })} />
        </AuthFrame>
      )
    case 'code':
      return (
        <AuthFrame
          panel="in"
          title={words.secondFactor.title}
          sub={view.method === 'app' ? words.secondFactor.app : view.hint ? fill(words.secondFactor.sms, { hint: view.hint.replace(/\D/g, '') }) : words.secondFactor.smsUnsent}
          back={{ label: words.back, onBack: () => go({ kind: 'login' }) }}
          icon={{ name: 'phone', tone: 'info' }}
          notice={notice}
        >
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <CodeField value={code} onValue={setCode} wait={wait} onResend={view.method === 'sms' ? resendSignIn : undefined} invalid={error !== null} />
            <Primary busy={busy}>{words.secondFactor.primary}</Primary>
            <Secondary onClick={() => go({ kind: 'backup' })}>{words.secondFactor.backup}</Secondary>
          </form>
        </AuthFrame>
      )
    case 'backup':
      return (
        <AuthFrame panel="in" title={words.backup.title} sub={words.backup.sub} back={{ label: words.back, onBack: () => go({ kind: 'login' }) }} icon={{ name: 'hash', tone: 'info' }} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <Field label={words.fields.backupCode} variant="backup" autoComplete="one-time-code" placeholder={words.fields.backupPlaceholder} value={code} onValue={setCode} invalid={error !== null} />
            <Primary busy={busy}>{words.backup.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'enrol':
      return (
        <AuthFrame
          panel="in"
          title={words.enrol.title}
          sub={view.hint ? fill(words.enrol.subSent, { hint: view.hint.replace(/\D/g, '') }) : words.enrol.sub}
          back={view.hint ? { label: words.enrol.changeNumber, onBack: () => go({ kind: 'enrol', hint: null }) } : { label: words.back, onBack: () => go({ kind: 'login' }) }}
          icon={{ name: 'phone', tone: 'info' }}
          notice={notice}
        >
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            {view.hint ? (
              <CodeField value={code} onValue={setCode} wait={wait} invalid={error !== null} />
            ) : (
              <Field label={words.fields.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder={words.fields.phonePlaceholder} value={phone} onValue={setPhone} invalid={error !== null} />
            )}
            <Primary busy={busy}>{view.hint ? words.enrol.confirmPrimary : words.enrol.sendPrimary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'codes':
      return <BackupCodes codes={view.codes} onDone={enter} />
    case 'locked':
      return (
        <AuthFrame panel="reset" title={fill(words.locked.title, { minutes: String(view.minutes) })} sub={words.locked.sub} icon={{ name: 'alert', tone: 'warning' }}>
          <form className="df-portal-auth-form" onSubmit={(event) => (event.preventDefault(), go({ kind: 'forgot' }))}>
            <Primary>{words.locked.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'forgot':
      return (
        <AuthFrame panel="reset" title={words.forgot.title} sub={words.forgot.sub} back={{ label: words.forgot.back, onBack: () => go({ kind: 'login' }) }} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <Field label={words.fields.email} type="email" autoComplete="email" placeholder={words.fields.emailPlaceholder} value={email} onValue={setEmail} invalid={error !== null} />
            <Primary busy={busy}>{words.forgot.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'sent':
      return (
        <AuthFrame panel="reset" title={words.forgot.sentTitle} sub={fill(words.forgot.sentSub, { email: view.email })} back={{ label: words.forgot.back, onBack: () => go({ kind: 'login' }) }} icon={{ name: 'mail', tone: 'info' }} notice={notice}>
          <Secondary onClick={() => void run(async () => setInfo(isRefusal(await requestPasswordReset(view.email)) ? words.rateLimited : words.secondFactor.sent))}>{words.forgot.again}</Secondary>
        </AuthFrame>
      )
  }
}
