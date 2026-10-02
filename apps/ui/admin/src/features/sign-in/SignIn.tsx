// States: start (default), signing, approve, code, cancelled, denied, unavailable, blocked,
// refused, expired. The button leaves for the Worker, which redirects to Microsoft (#89).
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import logoOnDark from '../../assets/dripfunnel-logo-inverse.svg'
import logo from '../../assets/dripfunnel-logo.svg'
import { messages } from '../../messages'
import { useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import '@dripfunnel/shared/ui/auth.css'
import './signIn.css'
import { SignInStep } from './SignInStep'
import { signInStates, type SignInState } from './signInStates'
import { useSignInOutcome } from './useSignInOutcome'

const words = messages.signIn

// How long the prototype waits for "Microsoft" before showing the Authenticator request.
const microsoftAnswerMs = 1100

// Walking through the prototype's flow locally is a review aid, so the simulated steps run
// only where the ?state= harness does. Everywhere else the button leaves for the Worker.
const signInRoute = '/api/auth/sign-in'

const leaveForMicrosoft = () => window.location.assign(signInRoute)

const ignore = () => undefined

export const SignIn = () => {
  const forced = useScreenState(signInStates, harnessEnabled)
  const outcome = useSignInOutcome()
  const [state, setState] = useState<SignInState>(forced ?? outcome ?? 'start')
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const shownState = useRef(state)

  useEffect(() => {
    setState(forced ?? outcome ?? 'start')
  }, [forced, outcome])

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
        {/* Two images toggled by the theme, as the prototype does it, rather than a
            <picture> keyed off prefers-color-scheme: since #81 the OS is only a default and
            `data-theme` decides, so a media query here would show the wrong logo whenever
            someone overrides it. `display: none` keeps the other out of the a11y tree. */}
        <img className="df-sign-in-logo-light" src={logo} alt={words.logoAlt} height={26} />
        <img className="df-sign-in-logo-dark" src={logoOnDark} alt={words.logoAlt} height={26} />
        <span className="df-sign-in-product">{words.productLabel}</span>
      </div>
      <main className="df-sign-in-card" aria-labelledby={headingId}>
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          {words.states[state].title}
        </h1>
        <p>{words.states[state].body}</p>
        <SignInStep
          state={state}
          onChange={harnessEnabled ? setState : leaveForMicrosoft}
          onSignedIn={harnessEnabled ? () => void navigate({ to: '/dashboard' }) : ignore}
        />
      </main>
      <p className="df-sign-in-footer">{words.footer}</p>
    </div>
  )
}
