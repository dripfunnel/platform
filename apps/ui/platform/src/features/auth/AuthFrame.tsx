import '@dripfunnel/shared/ui/auth.css'
import '@dripfunnel/shared/ui/states.css'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import logoOnDark from '../../assets/dripfunnel-logo-inverse.svg'
import logo from '../../assets/dripfunnel-logo.svg'
import { messages } from '../../messages'

const words = messages.auth

export interface AuthFrameProps {
  title: string
  body: string
  // The refusal or validation message, read as an alert.
  error?: string | null | undefined
  footer?: string | undefined
  children: ReactNode
}

// The signed-out card of the prototype: DripFunnel's mark and "Partners", a heading that takes
// focus when it changes so a screen reader hears the step, the body, then the step's form.
export const AuthFrame = ({ title, body, error, footer, children }: AuthFrameProps) => {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const shown = useRef(title)
  useEffect(() => {
    if (shown.current === title) return
    shown.current = title
    headingRef.current?.focus()
  }, [title])
  return (
    <div className="df-sign-in">
      <div className="df-sign-in-brand">
        <img className="df-sign-in-logo-light" src={logo} alt={words.logoAlt} height={26} />
        <img className="df-sign-in-logo-dark" src={logoOnDark} alt={words.logoAlt} height={26} />
        <span className="df-sign-in-product">{words.productLabel}</span>
      </div>
      <main className="df-sign-in-card" aria-labelledby={headingId}>
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p>{body}</p>
        {error && (
          <p className="df-sign-in-box df-sign-in-box--warning" role="alert">
            {error}
          </p>
        )}
        {children}
      </main>
      {footer && <p className="df-sign-in-footer">{footer}</p>}
    </div>
  )
}
