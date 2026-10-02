import { useId } from 'react'
import './list.css'

export interface FilterSelectProps<Value extends string> {
  label: string
  anyLabel: string
  options: readonly { value: Value; label: string }[]
  value: Value | undefined
  onChange: (value: Value | undefined) => void
}

// The label sits inside the control, as the prototype draws its filters; a chosen value
// tints it, so an applied filter is visible at a glance.
export const FilterSelect = <Value extends string>({ label, anyLabel, options, value, onChange }: FilterSelectProps<Value>) => {
  const id = useId()
  return (
    <label className={value ? 'df-list-select df-list-select--active' : 'df-list-select'} htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(options.find((option) => option.value === event.target.value)?.value)}
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
