import { safeNext } from '@dripfunnel/shared/ui'
import type { ReactNode } from 'react'
import googleMark from '../../assets/google-mark.svg'
import { currentBrand } from '../../brand/current'
import { messages } from '../../messages'
import { Field as CommonField, PasswordField as CommonPasswordField, Primary as CommonPrimary, Secondary as CommonSecondary, type FieldProps as CommonFieldProps } from '../common/fields'

const words = messages.auth

/** PortalAuth's password strength: length, mixed case, digits, symbols or extra length (0–4). */
export const strength = (password: string): number =>
  [password.length >= 10, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password) || password.length >= 12].filter(Boolean).length

type FieldProps = Omit<CommonFieldProps, 'look'>

export const Field = (props: FieldProps) => <CommonField look="auth" {...props} />

export const PasswordField = (props: Omit<FieldProps, 'type' | 'trailing'>) => <CommonPasswordField look="auth" show={words.show} hide={words.hide} {...props} />

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

/** Six digits; a phone code's "Send again" is CodeResend's, under it. */
export const CodeField = ({ value, onValue, invalid }: { value: string; onValue: (v: string) => void; invalid?: boolean | undefined }) => (
  <Field
    label={words.fields.code}
    value={value}
    onValue={(v) => onValue(v.replace(/\D/g, '').slice(0, 6))}
    variant="code"
    inputMode="numeric"
    autoComplete="one-time-code"
    placeholder={words.fields.codePlaceholder}
    invalid={invalid}
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

/** PortalAuth's "Continue with Google" and its divider, only while the partner's Google client is on (ACCESS.md §2). */
export const GoogleButton = ({ intent, next }: { intent: 'sign-in' | 'sign-up'; next?: string | undefined }) => {
  if (!currentBrand()?.googleSignIn) return null
  // A sign-in lands on the store chooser, as a password one does (SignIn `enter`); a sign-up comes back to its store step.
  const after = intent === 'sign-in' ? { next: `/stores?${new URLSearchParams({ next: safeNext(next, window.location.origin, '/home') }).toString()}` } : {}
  const href = `/api/auth/google/start?${new URLSearchParams({ intent, ...after }).toString()}`
  return (
    <>
      <a className="df-auth-secondary df-auth-google" href={href}>
        {/* Google's own mark in its own colours, as its branding requires: an asset, not tokens. */}
        <img src={googleMark} alt="" width={18} height={18} />
        {words.google.button}
      </a>
      <p className="df-auth-or">{words.google.or}</p>
    </>
  )
}

