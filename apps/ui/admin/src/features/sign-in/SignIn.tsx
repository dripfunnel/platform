// States: start (default), signing, approve, code, cancelled, denied, unavailable, blocked,
// refused, expired. Not wired to an API: #13 builds the staff sign-in endpoint.
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import logoOnDark from '../../assets/dripfunnel-logo-inverse.svg'
import logo from '../../assets/dripfunnel-logo.svg'
import { messages } from '../../messages'
import { useScreenState } from '../common/useScreenState'
import './signIn.css'
import { SignInStep } from './SignInStep'
import { signInStates, type SignInState } from './signInStates'

const words = messages.signIn

// How long the prototype waits for "Microsoft" before showing the Authenticator request.
const microsoftAnswerMs = 1100

export const SignIn = () => {
  const forced = useScreenState(signInStates)
  const [state, setState] = useState<SignInState>(forced ?? 'start')
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const shownState = useRef(state)

  useEffect(() => {
    setState(forced ?? 'start')
  }, [forced])

  useEffect(() => {
    // A forced ?state=signing stays put so it can be reviewed; a click moves on.
    if (state !== 'signing' || forced === 'signing') return
    const timer = setTimeout(() => setState('approve'), microsoftAnswerMs)
    return () => clearTimeout(timer)
  }, [state, forced])

  useEffect(() => {
    // Move focus to the new heading when the step changes, so a screen reader hears it.
    // Compared with the last step shown, because StrictMode runs this twice on mount.
    if (shownState.current === state) return
    shownState.current = state
    headingRef.current?.focus()
  }, [state])

  return (
    <div className="df-sign-in">
      <div className="df-sign-in-brand">
        <picture>
          <source srcSet={logoOnDark} media="(prefers-color-scheme: dark)" />
          <img src={logo} alt={words.logoAlt} height={26} />
        </picture>
        <span className="df-sign-in-product">{words.productLabel}</span>
      </div>
      <main className="df-sign-in-card" aria-labelledby={headingId}>
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          {words.states[state].title}
        </h1>
        <p>{words.states[state].body}</p>
        <SignInStep state={state} onChange={setState} onSignedIn={() => void navigate({ to: '/dashboard' })} />
      </main>
      <p className="df-sign-in-footer">{words.footer}</p>
    </div>
  )
}
