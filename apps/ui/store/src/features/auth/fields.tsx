import { useCallback, useEffect, useState, type ReactNode } from 'react'
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

export const Terms = ({ before, after }: { before: string; after: string }) => (
  <p className="df-auth-terms">
    {before}
    <a href={words.termsUrl} target="_blank" rel="noopener noreferrer">
      {words.terms.terms}
      <NewTab />
    </a>
    {words.terms.middle}
    <a href={words.privacyUrl} target="_blank" rel="noopener noreferrer">
      {words.terms.privacy}
      <NewTab />
    </a>
    {after}
  </p>
)
