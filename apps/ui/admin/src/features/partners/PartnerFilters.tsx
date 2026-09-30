import { useEffect, useId, useState } from 'react'
import { partnerStates, setupFilters, type PartnerFilter, type PartnerState, type SetupFilter } from '../../api/partners'
import { messages } from '../../messages'
import { isFiltered } from './isFiltered'
import './partners.css'

const words = messages.partners
const setupWords: Record<SetupFilter, string> = { complete: words.filters.complete, incomplete: words.filters.incomplete }

// Waits for a pause in typing, so each keystroke doesn't become a request.
const searchDelayMs = 300

export interface PartnerFiltersProps {
  filter: PartnerFilter
  onChange: (filter: PartnerFilter) => void
}

const withValue = <Key extends keyof PartnerFilter>(filter: PartnerFilter, key: Key, value: PartnerFilter[Key]): PartnerFilter => ({
  ...filter,
  [key]: value,
})

export const PartnerFilters = ({ filter, onChange }: PartnerFiltersProps) => {
  const searchId = useId()
  const stateId = useId()
  const setupId = useId()
  const [typed, setTyped] = useState(filter.q ?? '')

  useEffect(() => setTyped(filter.q ?? ''), [filter.q])

  useEffect(() => {
    const q = typed.trim()
    if (q === (filter.q ?? '')) return
    const timer = setTimeout(() => onChange(withValue(filter, 'q', q === '' ? undefined : q)), searchDelayMs)
    return () => clearTimeout(timer)
  }, [typed, filter, onChange])

  const active = isFiltered(filter)

  return (
    <form role="search" aria-label={words.filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
      <label className="df-list-search" htmlFor={searchId}>
        <span className="df-visually-hidden">{words.filters.search}</span>
        <input
          id={searchId}
          type="search"
          value={typed}
          placeholder={words.filters.searchPlaceholder}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <label className={filter.status ? 'df-list-select df-list-select--active' : 'df-list-select'} htmlFor={stateId}>
        <span>{words.filters.state}</span>
        <select
          id={stateId}
          value={filter.status ?? ''}
          onChange={(event) => onChange(withValue(filter, 'status', (event.target.value || undefined) as PartnerState | undefined))}
        >
          <option value="">{words.filters.anyState}</option>
          {partnerStates.map((state) => (
            <option key={state} value={state}>
              {words.states[state]}
            </option>
          ))}
        </select>
      </label>
      <label className={filter.setup ? 'df-list-select df-list-select--active' : 'df-list-select'} htmlFor={setupId}>
        <span>{words.filters.setup}</span>
        <select
          id={setupId}
          value={filter.setup ?? ''}
          onChange={(event) => onChange(withValue(filter, 'setup', (event.target.value || undefined) as SetupFilter | undefined))}
        >
          <option value="">{words.filters.anySetup}</option>
          {setupFilters.map((setup) => (
            <option key={setup} value={setup}>
              {setupWords[setup]}
            </option>
          ))}
        </select>
      </label>
      {active && (
        <button type="button" className="df-link-button" onClick={() => onChange({})}>
          {words.filters.clear}
        </button>
      )}
    </form>
  )
}
