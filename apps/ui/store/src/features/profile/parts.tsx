import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

// PortalProfile's pieces: a card per section, a labelled field with its help line, and the two buttons.

export const Card = ({ title, sub, aside, children }: { title: string; sub?: ReactNode; aside?: ReactNode; children?: ReactNode }) => (
  <section className="df-profile-card">
    <div className="df-profile-card-head">
      <div className="df-profile-card-title">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {aside}
    </div>
    {children}
  </section>
)

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string
  value: string
  onValue: (value: string) => void
  help?: ReactNode
  helpTone?: 'muted' | 'good' | 'bad' | undefined
  variant?: 'code' | undefined
}

export const Field = ({ label, value, onValue, help, helpTone = 'muted', variant, ...input }: FieldProps) => {
  const id = useId()
  return (
    <div className={`df-profile-field${variant ? ` df-profile-field--${variant}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => onValue(event.target.value)} aria-describedby={help ? `${id}-help` : undefined} {...input} />
      {help && (
        <span id={`${id}-help`} className={`df-profile-help df-profile-help--${helpTone}`}>
          {help}
        </span>
      )}
    </div>
  )
}

export const Primary = ({ children, onClick, busy, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit' }) => (
  <button type={type} className="df-profile-primary" onClick={onClick} disabled={disabled ?? busy} aria-busy={busy}>
    {children}
  </button>
)

export const Secondary = ({ children, onClick, size }: { children: ReactNode; onClick: () => void; size?: 'small' | 'strong' }) => (
  <button type="button" className={`df-profile-secondary${size ? ` df-profile-secondary--${size}` : ''}`} onClick={onClick}>
    {children}
  </button>
)

export const Alert = ({ text }: { text: string | null }) =>
  text ? (
    <p role="alert" className="df-profile-alert">
      {text}
    </p>
  ) : null
