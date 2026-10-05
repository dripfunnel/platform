import { LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { acceptInvitation, isRefusal, joinOutcome, joinStoreOnce, lookUpInvitation, type AuthRefusal, type Invitation as InvitationFacts } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { invitationStates, sampleInvitation } from './authStates'
import { AuthFrame } from './AuthFrame'
import { Field, Foot, NewPasswordField, Primary, productName, Terms } from './fields'
import { badInvitationKey, refusalText, roleWords } from './refusals'

const words = messages.auth
const iv = words.invite

type View = { kind: 'loading' } | { kind: 'bad'; refusal: AuthRefusal } | { kind: 'open'; facts: InvitationFacts } | { kind: 'joining'; facts: InvitationFacts }


const BadInvitation = ({ refusal }: { refusal: AuthRefusal }) => {
  const navigate = useNavigate()
  const copy = words.inviteBad[badInvitationKey(refusal)]
  return (
    <AuthFrame panel="in" title={copy.title} sub={fill(copy.sub, { inviter: refusal.invitedBy ?? '' })} icon={{ name: 'alert', tone: 'warning' }}>
      <Foot text={fill(iv.foot, { product: productName() })} link={words.inviteBad.signIn} onClick={() => void navigate({ to: '/sign-in' })} />
    </AuthFrame>
  )
}

// PortalAuth's invite and inviteBad views (ACCESS.md §6.2): `/accept-invite` sets a new person's name
// and password; `/join` adds an existing account signed in on this host, unchanged. ?state= per authStates.ts.
export const Invitation = ({ token, path }: { token: string | undefined; path: 'accept' | 'join' }) => {
  const navigate = useNavigate()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const forced = useScreenState(invitationStates, harnessEnabled)

  useEffect(() => {
    const shown = (answer: Awaited<ReturnType<typeof lookUpInvitation>>) => setView(isRefusal(answer) ? { kind: 'bad', refusal: answer } : { kind: 'open', facts: answer.invitation })
    if (forced) return shown(sampleInvitation(forced))
    if (!token) return setView({ kind: 'bad', refusal: { ok: false, code: 'INVITATION_INVALID' } })
    void lookUpInvitation(token).then(shown)
  }, [token, forced])

  // An existing account joins once its own session is here: straight away, or after signing in.
  const join = useCallback(
    async (facts: InvitationFacts) => {
      if (!token) return
      setView({ kind: 'joining', facts })
      setError(null)
      const answer = await joinStoreOnce(token)
      const next = joinOutcome(answer)
      if (next === 'signIn') return void navigate({ to: '/sign-in', search: { next: `/join?token=${encodeURIComponent(token)}` } })
      if (isRefusal(answer)) {
        if (next === 'bad') return setView({ kind: 'bad', refusal: answer })
        // The request failed, not the link: say so and wait for the person, never retry by ourselves.
        setView({ kind: 'open', facts })
        return setError(refusalText(answer))
      }
      void navigate(next === 'enrol' ? { to: '/sign-in', search: { step: 'enrol', next: '/home' } } : { to: '/stores', search: { next: '/home' } })
    },
    [token, navigate],
  )

  // Once per token, whatever the view does next; the button joins again after a failed request.
  const joined = useRef<string | null>(null)
  useEffect(() => {
    if (path !== 'join' || forced || !token || view.kind !== 'open' || view.facts.path !== 'join' || joined.current === token) return
    joined.current = token
    void join(view.facts)
  }, [path, forced, token, view, join])

  if (view.kind === 'loading') return <AuthFrame panel="in" title={iv.loading}><LoadingState label={iv.loading} /></AuthFrame>
  if (view.kind === 'bad') return <BadInvitation refusal={view.refusal} />
  const facts = view.facts
  const { role, can } = roleWords(facts)
  if (view.kind === 'joining') return <AuthFrame panel="in" title={fill(iv.joining, { store: facts.store })}><LoadingState label={fill(iv.joining, { store: facts.store })} /></AuthFrame>

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    if (facts.path === 'join') return void join(facts)
    if (!name.trim()) return setError(iv.nameRequired)
    if (password.length < 10) return setError(iv.weak)
    setBusy(true)
    void acceptInvitation(token, name.trim(), password).then((answer) => {
      setBusy(false)
      if (isRefusal(answer)) return answer.code.startsWith('INVITATION_') ? setView({ kind: 'bad', refusal: answer }) : setError(answer.code === 'NAME_REQUIRED' ? iv.nameRequired : answer.code === 'WEAK_PASSWORD' ? iv.weak : refusalText(answer))
      void navigate(answer.step === 'enrol' ? { to: '/sign-in', search: { step: 'enrol', next: '/home' } } : { to: '/stores', search: { next: '/home' } })
    })
  }

  return (
    <AuthFrame
      panel="in"
      title={fill(iv.title, { store: facts.store })}
      sub={fill(facts.path === 'join' ? iv.subJoin : iv.subNew, { inviter: facts.invitedBy, role, can })}
      icon={{ letter: facts.store.slice(0, 1).toUpperCase(), tone: 'warning' }}
      notice={error ? { text: error, tone: 'error' } : null}
    >
      <form className="df-portal-auth-form" onSubmit={submit} noValidate>
        {facts.path === 'new' && <Field label={words.fields.name} autoComplete="name" placeholder={words.fields.namePlaceholder} value={name} onValue={setName} />}
        <Field label={words.fields.email} type="email" value={facts.email} onValue={() => undefined} readOnly help={iv.emailHelp} />
        {facts.path === 'new' && <NewPasswordField label={words.fields.newPassword} value={password} onValue={setPassword} />}
        {facts.path === 'new' && <Terms before={iv.terms.before} after={iv.terms.after} />}
        <Primary busy={busy}>{facts.path === 'join' ? iv.joinPrimary : iv.primary}</Primary>
      </form>
      {facts.path === 'new' && <Foot text={fill(iv.foot, { product: productName() })} link={iv.footLink} onClick={() => void navigate({ to: '/sign-in', search: { next: `/join?token=${encodeURIComponent(token ?? '')}` } })} />}
    </AuthFrame>
  )
}
