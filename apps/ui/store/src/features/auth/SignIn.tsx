import { safeNext, useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { backupCodeFrom, confirmEnrolBySms, enrolBySms, isRefusal, requestPasswordReset, sendCode, signIn, useBackupCode, verifyCode, type Admitted, type AuthRefusal, type CodeChannel, type CodeChannels } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { sampleCodes, sampleEmail, sampleHint, signInStates, type SignInState } from './authStates'
import { AuthFrame } from './AuthFrame'
import { BackupCodes } from './BackupCodes'
import { CodeField, Field, Foot, GoogleButton, PasswordField, Primary, Secondary } from './fields'
import { afterRefusedSend, CodeResend, noCodeChannels, useResendWait, type SentCode } from '../common/CodeResend'
import { productName } from '../common/productName'
import { googleOutcomeText, refusalText, type GoogleOutcome } from './refusals'
import { looksLikeEmail } from '@dripfunnel/shared/format'

const words = messages.auth

type View =
  | { kind: 'login' }
  | { kind: 'code'; method: 'app' | 'sms'; sent: SentCode | null; channels: CodeChannels }
  | { kind: 'backup' }
  | { kind: 'enrol'; sent: SentCode | null; channels: CodeChannels }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'locked'; minutes: number }
  | { kind: 'forgot' }
  | { kind: 'sent'; email: string }

export interface SignInProps {
  next: string | undefined
  /** Where a session already started stands: a reset still owes its second factor, and set-up is only for a team that
   *  requires 2-factor (#1008; ACCESS.md §14.4). The pending cookie is already set. */
  resume?: { step: 'enrol' } | { step: 'second-factor'; method: 'app' | 'sms' } | undefined
  /** Why the person is here: signed out, or their session expired (FIRST-RELEASE §3.3). */
  note?: 'signedOut' | 'expired' | undefined
  /** Opens on "Forgot password", as a dead reset link's "Ask for a new link" does. */
  start?: 'forgot' | undefined
  /** Back from Google without a session: why, or the lock Google's account is under. */
  google?: GoogleOutcome | { locked: number } | undefined
}


type PhoneView = Extract<View, { kind: 'code' | 'enrol' }>

const bothChannels: CodeChannels = { whatsapp: true, sms: true }
const sampleSent = (channel: CodeChannel): SentCode => ({ channel, hint: sampleHint })

const forcedNote = (state: SignInState | null): 'expired' | 'signedOut' | undefined => (state === 'sessionExpired' ? 'expired' : state === 'signedOut' ? state : undefined)

// Where a harness state opens the screen, and the words it shows there.
const forcedStart = (state: SignInState): { view: View; error: string | null } => {
  switch (state) {
    case 'wrong':
      return { view: { kind: 'login' }, error: refusalText({ ok: false, code: 'INVALID_CREDENTIALS' }) }
    case 'code':
      return { view: { kind: 'code', method: 'sms', sent: sampleSent('whatsapp'), channels: bothChannels }, error: null }
    case 'codeSms':
      return { view: { kind: 'code', method: 'sms', sent: sampleSent('sms'), channels: bothChannels }, error: null }
    case 'codeNoSms':
      return { view: { kind: 'code', method: 'sms', sent: sampleSent('whatsapp'), channels: { whatsapp: true, sms: false } }, error: null }
    case 'codeNoChannel':
      return { view: { kind: 'code', method: 'sms', sent: null, channels: noCodeChannels }, error: words.secondFactor.noChannel }
    case 'codeApp':
      return { view: { kind: 'code', method: 'app', sent: null, channels: noCodeChannels }, error: null }
    case 'wrongCode':
      return { view: { kind: 'code', method: 'sms', sent: sampleSent('whatsapp'), channels: bothChannels }, error: refusalText({ ok: false, code: 'WRONG_CODE', triesLeft: 2 }) }
    case 'backup':
      return { view: { kind: 'backup' }, error: null }
    case 'enrol':
      return { view: { kind: 'enrol', sent: null, channels: noCodeChannels }, error: null }
    case 'enrolCode':
      return { view: { kind: 'enrol', sent: sampleSent('whatsapp'), channels: bothChannels }, error: null }
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
    case 'googleNoAccount':
      return { view: { kind: 'login' }, error: googleOutcomeText('no-account', productName()) }
    case 'googleCancelled':
      return { view: { kind: 'login' }, error: googleOutcomeText('cancelled', productName()) }
    case 'googleUnavailable':
      return { view: { kind: 'login' }, error: googleOutcomeText('unavailable', productName()) }
    case 'googleRefused':
      return { view: { kind: 'login' }, error: googleOutcomeText('refused', productName()) }
  }
}

const googleStart = (google: SignInProps['google']): { view: View; error: string | null } | null =>
  !google ? null : typeof google === 'object' ? { view: { kind: 'locked', minutes: google.locked }, error: null } : { view: { kind: 'login' }, error: googleOutcomeText(google, productName()) }

// PortalAuth's login, tfa, backup, enrol, locked and forgot views (FIRST-RELEASE §4; ACCESS.md §4; ?state=
// per authStates.ts). Admitted, the person goes to the store chooser, which opens their one store or asks which.
export const SignIn = ({ next, note, resume, start: opening, google }: SignInProps) => {
  const navigate = useNavigate()
  const forced = useScreenState(signInStates, harnessEnabled)
  const start = forced ? forcedStart(forced) : googleStart(google)
  const [view, setView] = useState<View>(
    start?.view ??
      (opening === 'forgot'
        ? { kind: 'forgot' }
        : resume?.step === 'enrol'
          ? { kind: 'enrol', sent: null, channels: noCodeChannels }
          : resume?.step === 'second-factor'
            ? { kind: 'code', method: resume.method, sent: null, channels: noCodeChannels }
            : { kind: 'login' }),
  )
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

  // A phone code's answer: where it went and where the next can go, or why none went (ACCESS.md §4).
  const showSend = (base: PhoneView, asked: CodeChannel | undefined, answer: { ok: true; hint: string; channel: CodeChannel; codeChannels: CodeChannels } | AuthRefusal, noneLeft: string) => {
    if (isRefusal(answer)) {
      const after = afterRefusedSend(answer, asked, base.channels, noneLeft)
      if (!after) return refused(answer)
      if (after.wait !== null) startWait(after.wait)
      setView({ ...base, channels: after.channels })
      setInfo(null)
      return setError(after.text)
    }
    startWait()
    setView({ ...base, sent: { channel: answer.channel, hint: answer.hint }, channels: answer.codeChannels })
    setError(null)
    setInfo(base.sent ? words.secondFactor.sent : null)
  }
  const sendSignInCode = async (base: PhoneView, asked?: CodeChannel) => showSend(base, asked, await sendCode(asked), words.secondFactor.noChannel)
  const sendEnrolCode = async (base: PhoneView, asked?: CodeChannel) => {
    const answer = await enrolBySms(phone.trim(), asked)
    if (isRefusal(answer)) return answer.code === 'INVALID_CREDENTIALS' ? setError(words.enrol.stale) : showSend(base, asked, answer, messages.codeResend.none)
    if ('hint' in answer) showSend(base, asked, answer, messages.codeResend.none)
  }

  const admitted = async (answer: Admitted) => {
    if (answer.step === 'done') return enter()
    if (answer.step === 'enrol') return go({ kind: 'enrol', sent: null, channels: noCodeChannels })
    if (answer.method === 'app') return go({ kind: 'code', method: 'app', sent: null, channels: noCodeChannels })
    const base: PhoneView = { kind: 'code', method: 'sms', sent: null, channels: answer.codeChannels ?? noCodeChannels }
    go(base)
    await sendSignInCode(base)
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
        if (view.sent === null) return sendEnrolCode(view)
        if (code.length !== 6) return setError(words.secondFactor.incomplete)
        const answer = await confirmEnrolBySms(code)
        if (isRefusal(answer)) return refused(answer)
        if ('backupCodes' in answer) go({ kind: 'codes', codes: answer.backupCodes })
        return
      }
      if (view.kind === 'forgot') {
        if (!looksLikeEmail(email)) return setError(words.forgot.invalid)
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

  // A resumed phone step sends its code once, as a fresh sign-in would.
  const texted = useRef(false)
  useEffect(() => {
    if (resume?.step !== 'second-factor' || resume.method !== 'sms' || texted.current) return
    texted.current = true
    void sendSignInCode({ kind: 'code', method: 'sms', sent: null, channels: noCodeChannels })
  }, [resume])
  const shownNote = note ?? forcedNote(forced)
  const notice = error ? { text: error, tone: 'error' as const } : info ? { text: info, tone: 'info' as const } : view.kind === 'login' && shownNote ? { text: words.signIn[shownNote], tone: 'info' as const } : null

  switch (view.kind) {
    case 'login':
      return (
        <AuthFrame panel="in" title={words.signIn.title} sub={words.signIn.sub} notice={notice}>
          <GoogleButton intent="sign-in" next={next} />
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
          sub={view.method === 'app' ? words.secondFactor.app : view.sent ? words.secondFactor.sms : words.secondFactor.smsUnsent}
          back={{ label: words.back, onBack: () => go({ kind: 'login' }) }}
          icon={{ name: 'phone', tone: 'info' }}
          notice={notice}
        >
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <CodeField value={code} onValue={setCode} invalid={error !== null} />
            {view.method === 'sms' && view.sent && <CodeResend sent={view.sent} channels={view.channels} wait={wait} busy={busy} onSend={(channel) => void run(() => sendSignInCode(view, channel))} />}
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
          sub={view.sent ? words.enrol.subSent : words.enrol.sub}
          back={view.sent ? { label: words.enrol.changeNumber, onBack: () => go({ kind: 'enrol', sent: null, channels: view.channels }) } : { label: words.back, onBack: () => go({ kind: 'login' }) }}
          icon={{ name: 'phone', tone: 'info' }}
          notice={notice}
        >
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            {view.sent ? (
              <>
                <CodeField value={code} onValue={setCode} invalid={error !== null} />
                <CodeResend sent={view.sent} channels={view.channels} wait={wait} busy={busy} onSend={(channel) => void run(() => sendEnrolCode(view, channel))} />
              </>
            ) : (
              <Field label={words.fields.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder={words.fields.phonePlaceholder} value={phone} onValue={setPhone} invalid={error !== null} />
            )}
            <Primary busy={busy}>{view.sent ? words.enrol.confirmPrimary : words.enrol.sendPrimary}</Primary>
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
          <Secondary
            onClick={() =>
              void run(async () => {
                const answer = await requestPasswordReset(view.email)
                if (isRefusal(answer)) {
                  setInfo(null)
                  return setError(refusalText(answer))
                }
                setError(null)
                setInfo(words.forgot.resent)
              })
            }
          >
            {words.forgot.again}
          </Secondary>
        </AuthFrame>
      )
  }
}
