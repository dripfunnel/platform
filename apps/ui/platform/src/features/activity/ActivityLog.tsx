import { ActionControl, EmptyState, ErrorState, ExportJobStatus, FilterSelect, ListHeader, LoadingState, PersonFinder, Tile, type ExportJobWords, type PersonOption } from '@dripfunnel/shared/ui'
import type { ExportJob } from '@dripfunnel/shared/graphql'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { activityResults, activityWhos, datePresets, type ActivityEntry, type ActivityFilter, type PersonMatch } from '../../api/activity'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import type { ActivityState } from './activityHarness'
import { ActivityRow } from './ActivityRow'
import { actionCodes } from './activityText'
import './activity.css'

const words = messages.activity
const filters = words.filters
const screen = messages.screens.activity
const actionNames: Record<string, string> = words.actionNames

const Header = ({ action }: { action?: React.ReactNode }) => <ListHeader title={screen.title} sub={screen.lede} action={action} />

export const ActivityLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const ActivityError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const jobWords: ExportJobWords = {
  preparing: words.export.preparing,
  ready: (count, truncated) => fill(plural(truncated ? words.export.truncated : words.export.ready, count), { count: formatCount(count) }),
  download: words.export.download,
  file: (date) => fill(words.export.file, { date }),
  expires: (time) => fill(words.export.expires, { time: formatTime(time) }),
  expired: words.export.expired,
  tooLarge: words.export.failed,
  failed: words.export.failed,
}

export const personOptionOf = (match: PersonMatch): PersonOption => ({
  id: match.ref,
  name: match.name,
  line: match.kind === 'team' ? fill(words.person.team, { role: (messages.shell.roles as Record<string, string>)[match.detail] ?? match.detail }) : fill(words.person.owner, { store: match.detail }),
  // The line already says which: "Your team · Admin" or "Owner of …".
  kind: '',
})

const finderWords = {
  label: words.person.label,
  placeholder: words.person.placeholder,
  hint: words.person.hint,
  none: words.person.none,
  results: (count: number) => fill(plural(words.person.results, count), { count: formatCount(count) }),
}

type FilterKey = keyof ActivityFilter

const chipLabel = (filter: ActivityFilter, key: FilterKey, stores: readonly { id: string; name: string }[]): string | null => {
  switch (key) {
    case 'who':
      return filter.who ? `${filters.who}: ${filters.whos[filter.who]}` : null
    case 'action':
      return filter.action ? `${filters.action}: ${actionNames[filter.action] ?? filter.action}` : null
    case 'result':
      return filter.result ? `${filters.result}: ${filters.results[filter.result]}` : null
    case 'storeId':
      return filter.storeId ? `${filters.store}: ${stores.find((store) => store.id === filter.storeId)?.name ?? filters.store}` : null
    case 'date':
      return filter.date ? `${filters.date}: ${filters.dates[filter.date]}` : null
  }
}

const filterKeys: readonly FilterKey[] = ['who', 'action', 'result', 'storeId', 'date']

export interface ActivityLogProps {
  entries: readonly ActivityEntry[]
  more: boolean
  moreState: 'idle' | 'busy' | 'failed'
  filter: ActivityFilter
  person: { ref: string; name: string | null } | null
  stores: readonly { id: string; name: string }[]
  forced: ActivityState | null
  exportJob: ExportJob | null
  canExport: boolean
  findPeople: (query: string) => Promise<readonly PersonOption[]>
  onChoosePerson: (option: PersonOption) => void
  onFilter: (filter: ActivityFilter) => void
  onMore: () => void
  onExport: () => void
  onRetry: () => void
}

export const ActivityLog = ({ entries, more, moreState, filter, person, stores, forced, exportJob, canExport, findPeople, onChoosePerson, onFilter, onMore, onExport, onRetry }: ActivityLogProps) => {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  if (forced === 'loading') return <ActivityLoading />
  if (forced === 'error') return <ActivityError onRetry={onRetry} />
  const shown = forced === 'empty' ? [] : entries
  const filtered = filterKeys.some((key) => filter[key] !== undefined) || person !== null
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const storeName = (id: string | null) => (id ? (stores.find((store) => store.id === id)?.name ?? null) : null)
  const set = <K extends FilterKey>(key: K, value: ActivityFilter[K]) => onFilter({ ...filter, [key]: value })
  const chips = filterKeys.flatMap((key) => {
    const label = chipLabel(filter, key, stores)
    return label === null ? [] : [{ key, label }]
  })

  return (
    <div className="df-page df-list df-activity-log">
      <Header
        action={
          <div className="df-activity-export">
            <ActionControl label={words.export.button} refusal={canExport ? null : words.export.refused} disabled={exportJob?.state === 'preparing'} onRun={onExport} />
            <p className="df-activity-export-status" role="status">
              {exportJob && <ExportJobStatus job={exportJob} words={jobWords} />}
            </p>
          </div>
        }
      />
      <PersonFinder find={findPeople} minChars={2} words={finderWords} onChoose={onChoosePerson} />
      {person && (
        <section className="df-person-card" aria-label={person.name ?? words.person.someone}>
          <Tile name={person.name ?? '?'} large neutral />
          <strong className="df-person-card-name">{person.name ? fill(words.person.timeline, { name: person.name }) : words.person.someone}</strong>
          <Link to="/activity" search={{ ...filter, person: undefined }} className="df-row-link">
            {words.person.everyone}
          </Link>
        </section>
      )}
      <div className="df-list-filters" role="group" aria-label={filters.label}>
        <FilterSelect label={filters.who} anyLabel={filters.anyone} options={activityWhos.map((who) => ({ value: who, label: filters.whos[who] }))} value={filter.who} onChange={(value) => set('who', value)} />
        <FilterSelect label={filters.action} anyLabel={filters.anyAction} options={actionCodes.map((code) => ({ value: code, label: actionNames[code] ?? code }))} value={filter.action} onChange={(value) => set('action', value)} />
        <FilterSelect label={filters.result} anyLabel={filters.anyResult} options={activityResults.map((result) => ({ value: result, label: filters.results[result] }))} value={filter.result} onChange={(value) => set('result', value)} />
        {stores.length > 0 && <FilterSelect label={filters.store} anyLabel={filters.anyStore} options={stores.map((store) => ({ value: store.id, label: store.name }))} value={filter.storeId} onChange={(value) => set('storeId', value)} />}
        <FilterSelect label={filters.date} anyLabel={filters.anyDate} options={datePresets.map((date) => ({ value: date, label: filters.dates[date] }))} value={filter.date} onChange={(value) => set('date', value)} />
      </div>
      {chips.length > 0 && (
        <div className="df-chips" role="group" aria-label={filters.label}>
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="df-chip" aria-label={fill(filters.remove, { label: chip.label })} onClick={() => set(chip.key, undefined)}>
              {chip.label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="df-link-button" onClick={() => onFilter({})}>
            {filters.clear}
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        filtered ? (
          <p className="df-muted">{words.none}</p>
        ) : (
          <EmptyState title={words.empty.title} body={words.empty.body} />
        )
      ) : (
        <>
          <span className="df-muted">{more ? fill(words.countMore, { count: formatCount(shown.length) }) : fill(plural(words.count, shown.length), { count: formatCount(shown.length) })}</span>
          <ul className="df-log-list" aria-label={words.listLabel}>
            {shown.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} storeName={storeName(entry.storeId)} open={open.has(entry.id)} onToggle={() => toggle(entry.id)} />
            ))}
          </ul>
          {moreState === 'failed' && <p role="alert">{words.moreFailed}</p>}
          {more && (
            <div className="df-show-more">
              <button type="button" className="df-button" disabled={moreState === 'busy'} onClick={onMore}>
                {words.showMore}
              </button>
            </div>
          )}
          <p className="df-muted">{words.readOnly}</p>
        </>
      )}
    </div>
  )
}
