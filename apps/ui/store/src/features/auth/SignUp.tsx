import { useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { isRefusal, resumeSignup, sendSignupPhone, signupStore, startSignup, verifySignupEmail, verifySignupPhone, type AuthRefusal, type CodeChannel, type CodeChannels, type Country } from '../../api/auth'
import { loadCodeChannels } from '../../api/brand'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { sampleCountries, sampleEmail, sampleHint, sampleSuggestions, signUpStates, type SignUpState } from './authStates'
import { AuthFrame } from './AuthFrame'
import { productName } from '../common/productName'
import { afterRefusedSend, CodeResend, useResendWait, type SentCode } from '../common/CodeResend'
import { CodeField, Field, Foot, GoogleButton, NewPasswordField, Primary, Terms } from './fields'
import { draftSubdomain, emptyStoreDraft, StoreFields, storeDraftProblem } from './StoreFields'
import { googleOutcomeText, signupText, type GoogleOutcome } from './refusals'
import { looksLikeEmail } from '@dripfunnel/shared/format'

const words = messages.auth
const su = words.signup

/** What the store step offers, kept on the number's step so a skipped number can go back to it. */
interface StoreFacts {
  countries: Country[]
  shopDomain: string | null
}

type View =
  | { kind: 'account' }
  | { kind: 'resuming' }
  | { kind: 'email' }
  | ({ kind: 'store' } & StoreFacts)
  | { kind: 'phone'; sent: SentCode | null; channels: CodeChannels; store: StoreFacts }
  | { kind: 'building'; enrol: boolean }

type PhoneView = Extract<View, { kind: 'phone' }>

interface Start {
  view: View
  error: string | null
  info?: string
  /** Whether the number's step is there: the partner's WhatsApp is on (SAAS.md §4.1). */
  withNumber?: boolean
}

const sampleStore = (): StoreFacts => ({ countries: [...sampleCountries], shopDomain: 'my-store.one' })
const samplePhone = (sent: SentCode['channel'] | null, channels: CodeChannels = { whatsapp: true, sms: true }): View => ({ kind: 'phone', sent: sent ? { channel: sent, hint: sampleHint } : null, channels, store: sampleStore() })

const forcedStart = (state: SignUpState): Start => {
  switch (state) {
    case 'email':
      return { view: { kind: 'email' }, error: null }
    case 'store':
      return { view: { kind: 'store', ...sampleStore() }, error: null }
    case 'storeNoPhone':
      return { view: { kind: 'store', ...sampleStore() }, error: null, withNumber: false }
    case 'taken':
      return { view: { kind: 'store', ...sampleStore() }, error: signupText({ ok: false, code: 'SUBDOMAIN_TAKEN', suggestions: [...sampleSuggestions] }) }
    case 'phone':
      return { view: samplePhone(null), error: null }
    case 'phoneCode':
      return { view: samplePhone('whatsapp'), error: null }
    case 'phoneCodeSms':
      return { view: samplePhone('sms'), error: null }
    case 'phoneCodeNoSms':
      return { view: samplePhone('whatsapp', { whatsapp: true, sms: false }), error: null }
    case 'phoneSkipped':
      return { view: { kind: 'store', ...sampleStore() }, error: null, info: su.su4.skipped, withNumber: false }
    case 'building':
      return { view: { kind: 'building', enrol: false }, error: null }
    case 'closed':
      return { view: { kind: 'account' }, error: signupText({ ok: false, code: 'SIGNUP_CLOSED' }) }
    case 'googleCancelled':
      return { view: { kind: 'account' }, error: googleOutcomeText('cancelled', productName()) }
    case 'googleUnavailable':
      return { view: { kind: 'account' }, error: googleOutcomeText('unavailable', productName()) }
    case 'googleRefused':
      return { view: { kind: 'account' }, error: googleOutcomeText('refused', productName()) }
  }
}

export interface SignUpProps {
  /** Back from Google at the store step: the sign-up's cookie is set, and the API says who it's for. */
  fromGoogle?: boolean | undefined
  /** Back from Google without a sign-up, and why. */
  google?: GoogleOutcome | undefined
}

// PortalAuth's su1–su4 and building views (FIRST-RELEASE §4; SAAS.md §4.1, §5): account, emailed code,
// store, the number's code while the partner's WhatsApp is on, then the store is made and the Owner goes straight in (#1008).
export const SignUp = ({ fromGoogle = false, google }: SignUpProps = {}) => {
  const navigate = useNavigate()
  const forced = useScreenState(signUpStates, harnessEnabled)
  const start: Start | null = forced ? forcedStart(forced) : google ? { view: { kind: 'account' }, error: googleOutcomeText(google, productName()) } : null
  const [view, setView] = useState<View>(start?.view ?? (fromGoogle ? { kind: 'resuming' } : { kind: 'account' }))
  const [name, setName] = useState('')
  const [email, setEmail] = useState(start ? sampleEmail : '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [draft, setDraft] = useState(emptyStoreDraft)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(start?.error ?? null)
  const [info, setInfo] = useState<string | null>(start?.info ?? null)
  const [withNumber, setWithNumber] = useState(start?.withNumber ?? true)
  const [busy, setBusy] = useState(false)
  const [wait, startWait] = useResendWait()
  const [resumeTry, setResumeTry] = useState(0)

  const go = (to: View) => {
    setView(to)
    setError(null)
    setInfo(null)
    setCode('')
  }
  const refused = (refusal: AuthRefusal) => {
    // A sign-up past its day starts again from the first step, as the prototype's back links do.
    if (refusal.code === 'SIGNUP_EXPIRED') go({ kind: 'account' })
    // The partner turned WhatsApp off since the store step: no number now, so the store step makes the store.
    if (refusal.code === 'STEP_SKIPPED' && view.kind === 'phone') {
      setWithNumber(false)
      go({ kind: 'store', ...view.store })
      return setInfo(su.su4.skipped)
    }
    setError(signupText(refusal))
  }

  useEffect(() => {
    if (!forced) return
    const next = forcedStart(forced)
    setView(next.view)
    setError(next.error)
    setInfo(next.info ?? null)
    setWithNumber(next.withNumber ?? true)
  }, [forced])

  // Numbers the steps from the first: three while the partner's WhatsApp is off. Until it answers, four, as drawn; a
  // Google sign-up hears it from `sign-up/resume`.
  useEffect(() => {
    if (forced || fromGoogle) return
    let current = true
    void loadCodeChannels()
      .then((channels) => {
        if (current && channels) setWithNumber(channels.whatsapp)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [forced, fromGoogle])

  // Google proved the address, so the sign-up carries on at the store step with Google's name and email.
  useEffect(() => {
    if (!fromGoogle || forced) return
    let current = true
    void resumeSignup().then((answer) => {
      if (!current) return
      // Only a sign-up that has gone starts again; anything else is worded and can be tried again from here.
      if (isRefusal(answer)) return answer.code === 'SIGNUP_EXPIRED' ? refused(answer) : setError(signupText(answer))
      setName(answer.name)
      setEmail(answer.email)
      setDraft((d) => ({ ...d, country: answer.countries[0]?.code ?? '' }))
      setWithNumber(answer.codeChannels.whatsapp)
      const store = { countries: answer.countries, shopDomain: answer.shopDomain }
      // Where the sign-up stands, not where Google left it: a reload after the store step goes on to the phone.
      go(answer.step === 'phone' ? { kind: 'phone', sent: null, channels: answer.codeChannels, store } : answer.step === 'verify-email' ? { kind: 'email' } : { kind: 'store', ...store })
    })
    return () => {
      current = false
    }
  }, [fromGoogle, forced, resumeTry])

  // The building view stays up while the API makes the store; it answers in the same request.
  useEffect(() => {
    if (view.kind !== 'building' || forced) return
    // The answer is 'enrol' only for a held session, which no sign-up leads to now (#1008).
    const leave = setTimeout(() => void (view.enrol ? navigate({ to: '/sign-in', search: { step: 'enrol', next: '/home' } }) : navigate({ to: '/stores', search: { next: '/home' } })), 1200)
    return () => clearTimeout(leave)
  }, [view, forced, navigate])

  // The number's code, by WhatsApp first; a refusal about the channel or the wait stays on this step (ACCESS.md §4).
  const sendPhone = async (base: PhoneView, asked?: CodeChannel) => {
    const answer = await sendSignupPhone(phone.trim(), asked)
    if (isRefusal(answer)) {
      const after = afterRefusedSend(answer, asked, base.channels, messages.codeResend.none)
      if (!after) return refused(answer)
      if (after.wait !== null) startWait(after.wait)
      setView({ ...base, channels: after.channels })
      return setError(after.text)
    }
    startWait()
    setView({ ...base, sent: { channel: answer.channel, hint: answer.hint }, channels: answer.codeChannels })
    setError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void (async () => {
      try {
        if (view.kind === 'account') {
          if (!name.trim()) return setError(su.su1.nameMissing)
          if (!looksLikeEmail(email)) return setError(su.su1.emailBad)
          if (password.length < 10) return setError(su.su1.weak)
          const answer = await startSignup(name.trim(), email.trim(), password)
          return isRefusal(answer) ? refused(answer) : go({ kind: 'email' })
        }
        if (view.kind === 'email') {
          if (code.length !== 6) return setError(words.secondFactor.incomplete)
          const answer = await verifySignupEmail(code)
          if (isRefusal(answer)) return refused(answer)
          setDraft((d) => ({ ...d, country: answer.countries[0]?.code ?? '' }))
          return go({ kind: 'store', countries: answer.countries, shopDomain: answer.shopDomain ?? null })
        }
        if (view.kind === 'store') {
          const problem = storeDraftProblem(draft)
          if (problem) return setError(problem)
          const answer = await signupStore(draft.store.trim(), draftSubdomain(draft), draft.country)
          if (isRefusal(answer)) return refused(answer)
          setWithNumber(answer.step === 'phone')
          if (answer.step === 'phone') return go({ kind: 'phone', sent: null, channels: answer.codeChannels, store: { countries: view.countries, shopDomain: view.shopDomain } })
          return go({ kind: 'building', enrol: answer.step === 'enrol' })
        }
        if (view.kind === 'phone') {
          if (view.sent === null) return await sendPhone(view)
          if (code.length !== 6) return setError(words.secondFactor.incomplete)
          const answer = await verifySignupPhone(code)
          return isRefusal(answer) ? refused(answer) : go({ kind: 'building', enrol: answer.step === 'enrol' })
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const resend = (base: PhoneView, channel: CodeChannel) => {
    setBusy(true)
    void sendPhone(base, channel).finally(() => setBusy(false))
  }

  const notice = error ? { text: error, tone: 'error' as const } : info ? { text: info, tone: 'info' as const } : null
  const stepCount = withNumber ? 4 : 3
  switch (view.kind) {
    case 'account':
      return (
        <AuthFrame panel="up" step={0} stepCount={stepCount} title={su.su1.title} sub={su.su1.sub} notice={notice}>
          <GoogleButton intent="sign-up" />
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <Field label={words.fields.name} autoComplete="name" placeholder={words.fields.namePlaceholder} value={name} onValue={setName} />
            <Field label={words.fields.email} type="email" autoComplete="email" placeholder={words.fields.emailPlaceholder} value={email} onValue={setEmail} />
            <NewPasswordField label={words.fields.newPassword} value={password} onValue={setPassword} />
            <Terms before={su.terms.before} after={su.terms.after} />
            <Primary busy={busy}>{su.su1.primary}</Primary>
          </form>
          <Foot text={su.su1.foot} link={su.su1.footLink} onClick={() => void navigate({ to: '/sign-in' })} />
        </AuthFrame>
      )
    case 'resuming':
      return (
        <AuthFrame panel="up" step={2} stepCount={stepCount} title={su.su3.title} sub={su.su3.sub} notice={notice}>
          {!error && (
            <p role="status" className="df-auth-help">
              {words.google.resuming}
            </p>
          )}
          {error && (
            <form className="df-portal-auth-form" onSubmit={(event) => (event.preventDefault(), setError(null), setResumeTry((n) => n + 1))} noValidate>
              <Primary>{words.google.retry}</Primary>
            </form>
          )}
        </AuthFrame>
      )
    case 'email':
      return (
        <AuthFrame panel="up" step={1} stepCount={stepCount} title={su.su2.title} sub={fill(su.su2.sub, { email: email.trim() })} back={{ label: su.su2.back, onBack: () => go({ kind: 'account' }) }} icon={{ name: 'mail', tone: 'info' }} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <CodeField value={code} onValue={setCode} invalid={error !== null} />
            <Primary busy={busy}>{su.su2.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'store':
      return (
        <AuthFrame panel="up" step={2} stepCount={stepCount} title={su.su3.title} sub={su.su3.sub} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <StoreFields draft={draft} onDraft={setDraft} countries={view.countries} shopDomain={view.shopDomain} />
            <Primary busy={busy}>{withNumber ? su.su3.primary : su.su3.primaryBuild}</Primary>
          </form>
        </AuthFrame>
      )
    case 'phone':
      return (
        <AuthFrame
          panel="up"
          step={3}
          stepCount={stepCount}
          title={view.sent ? su.su4.titleSent : su.su4.title}
          sub={view.sent ? undefined : su.su4.sub}
          back={view.sent ? { label: su.su4.changeNumber, onBack: () => go({ ...view, sent: null }) } : undefined}
          notice={notice}
        >
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            {view.sent ? (
              <>
                <CodeField value={code} onValue={setCode} invalid={error !== null} />
                <CodeResend sent={view.sent} channels={view.channels} wait={wait} busy={busy} onSend={(channel) => resend(view, channel)} />
              </>
            ) : (
              <Field label={words.fields.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder={words.fields.phonePlaceholder} value={phone} onValue={setPhone} />
            )}
            <Primary busy={busy}>{view.sent ? su.su4.primaryVerify : su.su4.primarySend}</Primary>
          </form>
        </AuthFrame>
      )
    case 'building':
      return <AuthFrame panel="up" step="building" stepCount={stepCount} icon={{ name: 'spark', tone: 'warning' }} title={fill(su.building.title, { store: draft.store.trim() || su.building.yourStore })} sub={su.building.sub} />
  }
}
