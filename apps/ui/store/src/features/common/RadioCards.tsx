import { useId, type ReactNode } from 'react'
import './radioCards.css'

export interface RadioCard<V extends string> {
  value: V
  label: ReactNode
  sub?: ReactNode
  extra?: ReactNode
}

/**
 * A choice of one drawn as cards (CatCollections' "How should it fill?", the tax tab's price mode). Native
 * radio inputs, so the group is one tab stop and the arrow keys move and select, as a radio group should.
 */
export const RadioCards = <V extends string>({ labelledBy, options, value, disabled, onChange, className }: { labelledBy: string; options: readonly RadioCard<V>[]; value: V; disabled: boolean; onChange: (value: V) => void; className?: string }) => {
  const name = useId()
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={className ? `df-radio-cards ${className}` : 'df-radio-cards'}>
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? 'df-radio-card df-radio-card--on' : 'df-radio-card'}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} />
          <span className="df-radio-card-text">
            <strong>{o.label}</strong>
            {o.sub && <span className="df-radio-card-sub">{o.sub}</span>}
            {o.extra}
          </span>
        </label>
      ))}
    </div>
  )
}
