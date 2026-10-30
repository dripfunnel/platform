import { safeNext } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { currentBrand } from '../../brand/current'
import { fill, messages } from '../../messages'
import { Field as CommonField, Primary as CommonPrimary, Secondary as CommonSecondary, type FieldProps as CommonFieldProps } from '../common/fields'

const words = messages.auth

/** PortalAuth's password strength: length, mixed case, digits, symbols or extra length (0–4). */
export const strength = (password: string): number =>
  [password.length >= 10, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password) || password.length >= 12].filter(Boolean).length

type FieldProps = Omit<CommonFieldProps, 'look'>

export const Field = (props: FieldProps) => <CommonField look="auth" {...props} />

export const PasswordField = (props: Omit<FieldProps, 'type' | 'trailing'>) => {
  const [shown, setShown] = useState(false)
  return (
    <Field
      {...props}
      type={shown ? 'text' : 'password'}
      trailing={
        <button type="button" className="df-auth-eye" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? words.hide : words.show}
        </button>
      }
    />
  )
}

/** A new password with PortalAuth's four-bar meter and its words. */
export const NewPasswordField = (props: Omit<FieldProps, 'type' | 'trailing' | 'help' | 'below'>) => {
  const level = strength(props.value)
  return (
    <PasswordField
      autoComplete="new-password"
      {...props}
      below={
        props.value ? (
          <span className="df-auth-meter" data-strength={level} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
        ) : undefined
      }
      help={words.strength[props.value ? level : 0]}
      helpTone={props.value !== '' && level < 2 ? 'weak' : undefined}
    />
  )
}

/** Seconds until another code may be asked for, counted down once a second. */
export const useResendWait = (): [number, () => void] => {
  const [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])
  const start = useCallback(() => setWait(30), [])
  return [wait, start]
}

/** Six digits, with PortalAuth's "Send again" and its 30-second wait. */
export const CodeField = ({ value, onValue, onResend, wait, invalid }: { value: string; onValue: (v: string) => void; onResend?: (() => void) | undefined; wait: number; invalid?: boolean | undefined }) => (
  <Field
    label={words.fields.code}
    value={value}
    onValue={(v) => onValue(v.replace(/\D/g, '').slice(0, 6))}
    variant="code"
    inputMode="numeric"
    autoComplete="one-time-code"
    placeholder={words.fields.codePlaceholder}
    invalid={invalid}
    aside={onResend && wait <= 0 ? { label: words.sendAgain, onClick: onResend } : undefined}
    help={onResend && wait > 0 ? fill(words.waitToResend, { seconds: String(wait) }) : undefined}
  />
)

export const Primary = ({ children, busy }: { children: ReactNode; busy?: boolean }) => (
  <CommonPrimary look="auth" type="submit" busy={busy}>
    {children}
  </CommonPrimary>
)

export const Secondary = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <CommonSecondary look="auth" onClick={onClick}>
    {children}
  </CommonSecondary>
)

export const Foot = ({ text, link, onClick }: { text: string; link: string; onClick: () => void }) => (
  <p className="df-auth-foot">
    {text}{' '}
    <button type="button" className="df-auth-link" onClick={onClick}>
      {link}
    </button>
  </p>
)

const NewTab = () => <span className="df-visually-hidden"> {words.opensInNewTab}</span>

// The partner's own pages (SAAS §3.4); one it hasn't set is named without a link.
const Policy = ({ label, url }: { label: string; url: string | null | undefined }) =>
  url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {label}
      <NewTab />
    </a>
  ) : (
    label
  )

export const Terms = ({ before, after }: { before: string; after: string }) => {
  const brand = currentBrand()
  return (
    <p className="df-auth-terms">
      {before}
      <Policy label={words.terms.terms} url={brand?.termsUrl} />
      {words.terms.middle}
      <Policy label={words.terms.privacy} url={brand?.privacyUrl} />
      {after}
    </p>
  )
}

// Google's own mark, in its own colours (Google's sign-in branding rules), as PortalAuth draws it.
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
)

/** PortalAuth's "Continue with Google" and its divider, only while the partner's Google client is on (ACCESS.md §2). */
export const GoogleButton = ({ intent, next }: { intent: 'sign-in' | 'sign-up'; next?: string | undefined }) => {
  if (!currentBrand()?.googleSignIn) return null
  // A sign-in lands on the store chooser, as a password one does (SignIn `enter`); a sign-up comes back to its store step.
  const after = intent === 'sign-in' ? { next: `/stores?${new URLSearchParams({ next: safeNext(next, window.location.origin, '/home') }).toString()}` } : {}
  const href = `/api/auth/google/start?${new URLSearchParams({ intent, ...after }).toString()}`
  return (
    <>
      <a className="df-auth-secondary df-auth-google" href={href}>
        <GoogleMark />
        {words.google.button}
      </a>
      <p className="df-auth-or">{words.google.or}</p>
    </>
  )
}

