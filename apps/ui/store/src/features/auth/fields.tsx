import { useCallback, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { currentBrand } from '../../brand/current'
import { fill, messages } from '../../messages'

const words = messages.auth

/** PortalAuth's password strength: length, mixed case, digits, symbols or extra length (0–4). */
export const strength = (password: string): number =>
  [password.length >= 10, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password) || password.length >= 12].filter(Boolean).length

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string
  value: string
  onValue: (value: string) => void
  aside?: { label: string; onClick: () => void } | undefined
  help?: ReactNode
  helpWeak?: boolean | undefined
  invalid?: boolean | undefined
  prefix?: string | undefined
  suffix?: string | undefined
  variant?: 'code' | 'backup' | undefined
  trailing?: ReactNode
  below?: ReactNode
}

export const Field = ({ label, value, onValue, aside, help, helpWeak, invalid, prefix, suffix, variant, trailing, below, ...input }: FieldProps) => {
  const id = useId()
  const helpId = useId()
  return (
    <div className="df-auth-field">
      <span className="df-auth-label">
        <label htmlFor={id}>{label}</label>
        {aside && (
          <button type="button" className="df-auth-aside" onClick={aside.onClick}>
            {aside.label}
          </button>
        )}
      </span>
      <span className={`df-auth-control${variant ? ` df-auth-control--${variant}` : ''}`} data-invalid={invalid ? 'true' : undefined}>
        {prefix && <span className="df-auth-affix">{prefix}</span>}
        <input id={id} value={value} onChange={(event) => onValue(event.target.value)} aria-invalid={invalid || undefined} aria-describedby={help ? helpId : undefined} {...input} />
        {suffix && <span className="df-auth-affix">{suffix}</span>}
        {trailing}
      </span>
      {below}
      {help && (
        <span id={helpId} className={`df-auth-help${helpWeak ? ' df-auth-help--weak' : ''}`}>
          {help}
        </span>
      )}
    </div>
  )
}

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
      helpWeak={props.value !== '' && level < 2}
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
  <button type="submit" className="df-auth-primary" disabled={busy} aria-busy={busy || undefined}>
    {children}
  </button>
)

export const Secondary = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button type="button" className="df-auth-secondary" onClick={onClick}>
    {children}
  </button>
)

export const Foot = ({ text, link, onClick }: { text: string; link: string; onClick: () => void }) => (
  <p className="df-auth-foot">
    {text}{' '}
    <button type="button" className="df-auth-link" onClick={onClick}>
      {link}
    </button>
  </p>
)

/** The product the person signs in to: the partner's name for it, else DripFunnel's. */
export const productName = (): string => currentBrand()?.productName ?? words.productName

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
