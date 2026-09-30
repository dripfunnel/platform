import type { PartnerOption } from '../../api/dashboard'
import { fill, messages } from '../../messages'
import './dashboard.css'

const words = messages.dashboard.filter

export interface PartnerFilterProps {
  options: readonly PartnerOption[]
  value: string | null
  onChange: (partnerId: string | undefined) => void
}

export const PartnerFilter = ({ options, value, onChange }: PartnerFilterProps) => {
  const selected = options.find((option) => option.id === value)
  return (
    <div className="df-filter-bar">
      <label className="df-filter">
        <span>{words.label}</span>
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
          <option value="">{words.all}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <p className="df-muted" role="status">
        {selected ? fill(words.countOne, { name: selected.name }) : words.countAll}
      </p>
    </div>
  )
}
