// States: start (default), signing, approve, code, cancelled, denied, unavailable, blocked,
// refused, expired. Not wired to an API: #13 builds the staff sign-in endpoint.
import { useEffect, useId, useRef, useState } from 'react'
import logoOnDark from '../../assets/dripfunnel-logo-inverse.svg'
import logo from '../../assets/dripfunnel-logo.svg'
import { messages } from '../../messages'
import { useScreenState } from '../common/useScreenState'
import './signIn.css'
import { SignInStep } from './SignInStep'
import { signInStates, type SignInState } from './signInStates'

const words = messages.signIn

export const SignIn = () => {
  const forced = useScreenState(signInStates)
  const [state, setState] = useState<SignInState>(forced ?? 'start')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const stepChanged = useRef(false)

  useEffect(() => {
    setState(forced ?? 'start')
  }, [forced])

  useEffect(() => {
    // Move focus to the new heading when the step changes, so a screen reader hears it.
    if (stepChanged.current) headingRef.current?.focus()
    stepChanged.current = true
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
        <SignInStep state={state} onChange={setState} />
      </main>
      <p className="df-sign-in-footer">{words.footer}</p>
    </div>
  )
}
