import { useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { isRefusal, sendSignupPhone, signupStore, startSignup, subdomainFrom, verifySignupEmail, verifySignupPhone, type AuthRefusal, type Country } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { sampleCountries, sampleEmail, sampleHint, sampleSuggestions, signUpStates, type SignUpState } from './authStates'
import { AuthFrame } from './AuthFrame'
import { CodeField, Field, Foot, NewPasswordField, Primary, Terms, useResendWait } from './fields'
import { signupText } from './refusals'

const words = messages.auth
const su = words.signup

type View = { kind: 'account' } | { kind: 'email' } | { kind: 'store'; countries: Country[] } | { kind: 'phone'; hint: string | null } | { kind: 'building'; enrol: boolean }


const forcedStart = (state: SignUpState): { view: View; error: string | null } => {
  switch (state) {
    case 'email':
      return { view: { kind: 'email' }, error: null }
    case 'store':
      return { view: { kind: 'store', countries: [...sampleCountries] }, error: null }
    case 'taken':
      return { view: { kind: 'store', countries: [...sampleCountries] }, error: signupText({ ok: false, code: 'SUBDOMAIN_TAKEN', suggestions: [...sampleSuggestions] }) }
    case 'phone':
      return { view: { kind: 'phone', hint: null }, error: null }
    case 'phoneCode':
      return { view: { kind: 'phone', hint: sampleHint }, error: null }
    case 'building':
      return { view: { kind: 'building', enrol: false }, error: null }
    case 'closed':
      return { view: { kind: 'account' }, error: signupText({ ok: false, code: 'SIGNUP_CLOSED' }) }
  }
}

// PortalAuth's su1–su4 and building views (FIRST-RELEASE §4; SAAS.md §4.1, §5): account, emailed code,
// store, texted code, then the store is made and an Owner sets up two-step sign-in; ?state= per authStates.ts.
export const SignUp = () => {
  const navigate = useNavigate()
  const forced = useScreenState(signUpStates, harnessEnabled)
  const start = forced ? forcedStart(forced) : null
  const [view, setView] = useState<View>(start?.view ?? { kind: 'account' })
  const [name, setName] = useState('')
  const [email, setEmail] = useState(start ? sampleEmail : '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [store, setStore] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subTouched, setSubTouched] = useState(false)
  const [country, setCountry] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(start?.error ?? null)
  const [busy, setBusy] = useState(false)
  const [wait, startWait] = useResendWait()

  const go = (to: View) => {
    setView(to)
    setError(null)
    setCode('')
  }
  const refused = (refusal: AuthRefusal) => {
    // A sign-up past its day starts again from the first step, as the prototype's back links do.
    if (refusal.code === 'SIGNUP_EXPIRED') go({ kind: 'account' })
    setError(signupText(refusal))
  }

  useEffect(() => {
    if (!forced) return
    const next = forcedStart(forced)
    setView(next.view)
    setError(next.error)
  }, [forced])

  // The building view stays up while the API makes the store; it answers in the same request.
  useEffect(() => {
    if (view.kind !== 'building' || forced) return
    // An Owner sets up two-step sign-in before the store opens (ACCESS.md §4): sign-in's set-up step.
    const leave = setTimeout(() => void (view.enrol ? navigate({ to: '/sign-in', search: { step: 'enrol', next: '/home' } }) : navigate({ to: '/stores', search: { next: '/home' } })), 1200)
    return () => clearTimeout(leave)
  }, [view, forced, navigate])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void (async () => {
      try {
        if (view.kind === 'account') {
          if (!name.trim()) return setError(su.su1.nameMissing)
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(su.su1.emailBad)
          if (password.length < 10) return setError(su.su1.weak)
          const answer = await startSignup(name.trim(), email.trim(), password)
          return isRefusal(answer) ? refused(answer) : go({ kind: 'email' })
        }
        if (view.kind === 'email') {
          if (code.length !== 6) return setError(words.secondFactor.incomplete)
          const answer = await verifySignupEmail(code)
          if (isRefusal(answer)) return refused(answer)
          setCountry(answer.countries[0]?.code ?? '')
          return go({ kind: 'store', countries: answer.countries })
        }
        if (view.kind === 'store') {
          const sub = subdomain || subdomainFrom(store)
          if (!store.trim()) return setError(su.su3.nameMissing)
          if (!sub) return setError(su.su3.subBad)
          if (!country) return setError(su.su3.countryNone)
          const answer = await signupStore(store.trim(), sub, country)
          return isRefusal(answer) ? refused(answer) : go({ kind: 'phone', hint: null })
        }
        if (view.kind === 'phone') {
          if (view.hint === null) {
            const answer = await sendSignupPhone(phone.trim())
            if (isRefusal(answer)) return refused(answer)
            startWait()
            setView({ kind: 'phone', hint: answer.hint })
            return setError(null)
          }
          if (code.length !== 6) return setError(words.secondFactor.incomplete)
          const answer = await verifySignupPhone(code)
          return isRefusal(answer) ? refused(answer) : go({ kind: 'building', enrol: answer.step === 'enrol' })
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const notice = error ? { text: error, tone: 'error' as const } : null
  switch (view.kind) {
    case 'account':
      return (
        <AuthFrame panel="up" step={0} title={su.su1.title} sub={su.su1.sub} notice={notice}>
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
    case 'email':
      return (
        <AuthFrame panel="up" step={1} title={su.su2.title} sub={fill(su.su2.sub, { email: email.trim() })} back={{ label: su.su2.back, onBack: () => go({ kind: 'account' }) }} icon={{ name: 'mail', tone: 'info' }} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <CodeField value={code} onValue={setCode} wait={wait} invalid={error !== null} />
            <Primary busy={busy}>{su.su2.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'store':
      return (
        <AuthFrame panel="up" step={2} title={su.su3.title} sub={su.su3.sub} notice={notice}>
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            <Field label={su.su3.store} placeholder={su.su3.storePlaceholder} value={store} onValue={(v) => (setStore(v), subTouched ? undefined : setSubdomain(subdomainFrom(v)))} help={su.su3.storeHelp} />
            <Field label={su.su3.sub2} placeholder={su.su3.subPlaceholder} value={subdomain} onValue={(v) => (setSubTouched(true), setSubdomain(v.toLowerCase()))} help={su.su3.subHelp} />
            <div className="df-auth-field">
              <label className="df-auth-label" htmlFor="signup-country">
                {su.su3.country}
              </label>
              <span className="df-auth-control">
                <select id="signup-country" value={country} onChange={(event) => setCountry(event.target.value)}>
                  {view.countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} · {c.currency}
                    </option>
                  ))}
                </select>
              </span>
              <span className="df-auth-help">{su.su3.countryHelp}</span>
            </div>
            <Primary busy={busy}>{su.su3.primary}</Primary>
          </form>
        </AuthFrame>
      )
    case 'phone':
      return (
        <AuthFrame
          panel="up"
          step={3}
          title={view.hint ? su.su4.titleSent : su.su4.title}
          sub={view.hint ? fill(su.su4.subSent, { hint: view.hint.replace(/\D/g, '') }) : su.su4.sub}
          back={view.hint ? { label: su.su4.changeNumber, onBack: () => go({ kind: 'phone', hint: null }) } : undefined}
          notice={notice}
        >
          <form className="df-portal-auth-form" onSubmit={submit} noValidate>
            {view.hint ? (
              <CodeField value={code} onValue={setCode} wait={wait} invalid={error !== null} />
            ) : (
              <Field label={words.fields.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder={words.fields.phonePlaceholder} value={phone} onValue={setPhone} />
            )}
            <Primary busy={busy}>{view.hint ? su.su4.primaryVerify : su.su4.primarySend}</Primary>
          </form>
        </AuthFrame>
      )
    case 'building':
      return <AuthFrame panel="up" step="building" icon={{ name: 'spark', tone: 'warning' }} title={fill(su.building.title, { store: store.trim() || su.building.yourStore })} sub={su.building.sub} />
  }
}
