import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { activityResults, actorKinds, datePresets, type ActivityFilter, type ActivityPage } from '../../api/activity'
import { activityLevels, levelOf, type ActionCode } from '../../api/activityActions'
import { fill, messages } from '../../messages'
import { FilterSelect, SearchField } from '@dripfunnel/shared/ui'
import { ipPattern } from './activitySearch'
import './activity.css'

const words = messages.activity
const filters = words.filters

const ipError = (value: string) => (ipPattern.test(value) ? null : filters.ipInvalid)

const today = () => new Date().toISOString().slice(0, 10)

// The Action filter, grouped by level (decided on #44), over the set this view offers.
const ActionSelect = ({ actions, value, onChange }: { actions: readonly ActionCode[]; value: ActionCode | undefined; onChange: (value: ActionCode | undefined) => void }) => {
  const id = useId()
  return (
    <label className={value ? 'df-list-select df-list-select--active' : 'df-list-select'} htmlFor={id}>
      <span>{filters.action}</span>
      <select id={id} value={value ?? ''} onChange={(event) => onChange(actions.find((code) => code === event.target.value))}>
        <option value="">{filters.anyAction}</option>
        {activityLevels.map((level) => {
          const codes = actions.filter((code) => levelOf(code) === level)
          return codes.length === 0 ? null : (
            <optgroup key={level} label={words.levels[level]}>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {words.actionNames[code]}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </label>
  )
}

const DateFilter = ({ filter, onChange }: { filter: ActivityFilter; onChange: (filter: ActivityFilter) => void }) => {
  const fromId = useId()
  const toId = useId()
  const custom = filter.from !== undefined || filter.to !== undefined
  const options = [...datePresets.map((preset) => ({ value: preset, label: filters.dates[preset] })), { value: 'custom' as const, label: filters.dates.custom }]
  const rest: ActivityFilter = { ...filter, date: undefined, from: undefined, to: undefined }
  return (
    <>
      <FilterSelect
        label={filters.date}
        anyLabel={filters.anyDate}
        options={options}
        value={custom ? 'custom' : filter.date}
        onChange={(value) => onChange(value === 'custom' ? { ...rest, from: today(), to: today() } : { ...rest, date: value })}
      />
      {custom && (
        <>
          <label className="df-list-select df-list-select--active" htmlFor={fromId}>
            <span>{filters.from}</span>
            <input id={fromId} type="date" value={filter.from ?? ''} max={filter.to} onChange={(event) => onChange({ ...filter, from: event.target.value || undefined })} />
          </label>
          <label className="df-list-select df-list-select--active" htmlFor={toId}>
            <span>{filters.to}</span>
            <input id={toId} type="date" value={filter.to ?? ''} min={filter.from} onChange={(event) => onChange({ ...filter, to: event.target.value || undefined })} />
          </label>
        </>
      )}
    </>
  )
}

export interface ActivityFiltersProps {
  filter: ActivityFilter
  onChange: (filter: ActivityFilter) => void
  actions: readonly ActionCode[]
  // The Activity log's further filters (FIRST-RELEASE.md §9); a tab shows only the shared three.
  scopes?: Pick<ActivityPage, 'partners' | 'stores'>
}

export const ActivityFilters = ({ filter, onChange, actions, scopes }: ActivityFiltersProps) => (
  <form role="search" aria-label={filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
    {scopes && (
      <FilterSelect
        label={filters.actor}
        anyLabel={filters.anyActor}
        options={actorKinds.map((kind) => ({ value: kind, label: words.actorKinds[kind] }))}
        value={filter.actor}
        onChange={(actor) => onChange({ ...filter, actor })}
      />
    )}
    {scopes && (
      <FilterSelect
        label={filters.level}
        anyLabel={filters.anyLevel}
        options={activityLevels.map((level) => ({ value: level, label: words.levels[level] }))}
        value={filter.level}
        onChange={(level) => onChange({ ...filter, level })}
      />
    )}
    <ActionSelect actions={actions} value={filter.action} onChange={(action) => onChange({ ...filter, action })} />
    <FilterSelect
      label={filters.result}
      anyLabel={filters.anyResult}
      options={activityResults.map((result) => ({ value: result, label: words.results[result] }))}
      value={filter.result}
      onChange={(result) => onChange({ ...filter, result })}
    />
    {scopes && (
      <FilterSelect
        label={filters.partner}
        anyLabel={filters.anyPartner}
        options={scopes.partners.map((partner) => ({ value: partner.id, label: partner.name }))}
        value={filter.partner}
        onChange={(partner) => onChange({ ...filter, partner, store: undefined })}
      />
    )}
    {scopes && (
      <FilterSelect
        label={filters.store}
        anyLabel={filters.anyStore}
        options={scopes.stores.filter((store) => !filter.partner || store.partnerId === filter.partner).map((store) => ({ value: store.id, label: store.name }))}
        value={filter.store}
        onChange={(store) => onChange({ ...filter, store })}
      />
    )}
    <DateFilter filter={filter} onChange={onChange} />
    {scopes && <SearchField label={filters.ip} placeholder={filters.ipPlaceholder} value={filter.ip} onChange={(ip) => onChange({ ...filter, ip })} validate={ipError} labelVisible />}
  </form>
)

export interface ActivityChipsProps {
  filter: ActivityFilter
  remove: (key: 'customer' | 'target' | 'imp' | 'su') => ActivityFilter
}

// Filters set by a link rather than a control, shown so they can be seen and removed.
export const ActivityChips = ({ filter, remove }: ActivityChipsProps) => {
  const chips = [
    filter.customer && { key: 'customer' as const, label: fill(filters.customer, { id: filter.customer }) },
    filter.target && { key: 'target' as const, label: fill(filters.target, { target: filter.target }) },
    filter.imp && { key: 'imp' as const, label: fill(filters.imp, { id: filter.imp }) },
    filter.su && { key: 'su' as const, label: fill(filters.su, { id: filter.su }) },
  ].filter((chip) => typeof chip === 'object')
  if (chips.length === 0) return null
  return (
    <ul className="df-activity-chips">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link to="/activity" search={remove(chip.key)} aria-label={fill(filters.removeLabel, { filter: chip.label })} className="df-activity-chip">
            {chip.label}
            <span aria-hidden="true">×</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
