import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

// The one labelled field and the two buttons, for every area of the portal (docs/ui/README.md §2). An
// area keeps its prototype's look through `look`, which picks its classes (auth.css, profile.css).

export type Look = 'auth' | 'profile'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'prefix'> {
  look: Look
  label: string
  value: string
  onValue: (value: string) => void
  aside?: { label: string; onClick: () => void } | undefined
  help?: ReactNode
  helpTone?: 'muted' | 'good' | 'weak' | undefined
  invalid?: boolean | undefined
  prefix?: string | undefined
  suffix?: string | undefined
  variant?: 'code' | 'backup' | undefined
  trailing?: ReactNode
  below?: ReactNode
}

export const Field = ({ look, label, value, onValue, aside, help, helpTone, invalid, prefix, suffix, variant, trailing, below, ...input }: FieldProps) => {
  const id = useId()
  const helpId = useId()
  return (
    <div className={`df-${look}-field`}>
      <span className={`df-${look}-label`}>
        <label htmlFor={id}>{label}</label>
        {aside && (
          <button type="button" className={`df-${look}-aside`} onClick={aside.onClick}>
            {aside.label}
          </button>
        )}
      </span>
      <span className={`df-${look}-control${variant ? ` df-${look}-control--${variant}` : ''}`} data-invalid={invalid ? 'true' : undefined} data-readonly={input.readOnly ? 'true' : undefined}>
        {prefix && <span className={`df-${look}-affix`}>{prefix}</span>}
        <input id={id} value={value} onChange={(event) => onValue(event.target.value)} aria-invalid={invalid || undefined} aria-describedby={help ? helpId : undefined} {...input} />
        {suffix && <span className={`df-${look}-affix`}>{suffix}</span>}
        {trailing}
      </span>
      {below}
      {help && (
        <span id={helpId} className={`df-${look}-help${helpTone ? ` df-${look}-help--${helpTone}` : ''}`}>
          {help}
        </span>
      )}
    </div>
  )
}

export const Primary = ({ look, children, onClick, busy, disabled, type }: { look: Look; children: ReactNode; onClick?: (() => void) | undefined; busy?: boolean | undefined; disabled?: boolean | undefined; type: 'button' | 'submit' }) => (
  <button type={type} className={`df-${look}-primary`} onClick={onClick} disabled={disabled ?? busy} aria-busy={busy || undefined}>
    {children}
  </button>
)

export const Secondary = ({ look, children, onClick, size }: { look: Look; children: ReactNode; onClick: () => void; size?: 'small' | 'strong' | undefined }) => (
  <button type="button" className={`df-${look}-secondary${size ? ` df-${look}-secondary--${size}` : ''}`} onClick={onClick}>
    {children}
  </button>
)
