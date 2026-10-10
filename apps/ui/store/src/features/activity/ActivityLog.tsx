import { EmptyState, ErrorState, ExportJobStatus, initials, LoadingState, type ExportJobWords } from '@dripfunnel/shared/ui'
import { searchMaxLength } from '@dripfunnel/shared/search'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { activityWhats, requestActivityExport, type ActivityEntry, type ActivityFilter, type ActivityPage } from '../../api/activity'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { startListExport, useListExport } from '../common/listExport'
import '../settings/settings.css'
import './activity.css'
import type { ActivitySearch } from './activitySearch'
import { actorOf, doneOf, kindOf, nameOf, personOf, targetLink } from './activityText'

const words = messages.activity
const ex = words.exportWords

const exportWords: ExportJobWords = {
  preparing: ex.preparing,
  ready: (count, truncated) => (truncated ? fill(ex.truncated, { count: formatCount(count) }) : fill(plural(ex.ready, count), { count: formatCount(count) })),
  download: ex.download,
  file: (date) => fill(ex.file, { date }),
  expires: (time) => fill(ex.expires, { time: formatTime(time) }),
  expired: ex.expired,
  tooLarge: ex.tooLarge,
  failed: ex.failed,
}

/** How long typing waits before the search reaches the address and the API. */
const typingMs = 300

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; entries: readonly ActivityEntry[]; next: string | null; more: 'idle' | 'loading' | 'failed' }

const filterOf = (search: ActivitySearch): ActivityFilter => {
  const [kind, ...id] = (search.who ?? '').split(':')
  return { person: kind && id.length ? { kind, id: id.join(':') } : null, what: search.what ?? null, search: search.q ?? '' }
}

export interface ActivityLogProps {
  /** "Activity log" in the Owner's Settings, "Store activity" for a Manager. */
  title: string
  /** A page's own heading, or a Settings tab's. */
  heading: 'h1' | 'h2'
  search: ActivitySearch
  onSearch: (next: ActivitySearch) => void
  read: (filter: ActivityFilter, after: string | null) => Promise<ActivityPage>
  /** `activity.export`: the Owner's alone (ACCESS §5.1); anyone else sees the button disabled with the reason. */
  canExport: boolean
  /** Under the harness nothing is sent to the API. */
  sample: boolean
}

/** The store's activity log (StoreActivity, FIRST-RELEASE §15, LOGGING §6–7): filter by person, what and words; every name a link. */
export const ActivityLog = ({ title, heading: Heading, search, onSearch, read, canExport, sample }: ActivityLogProps) => {
  const id = useId()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [typed, setTyped] = useState(search.q ?? '')
  const [open, setOpen] = useState<string | null>(null)
  const latest = useRef(0)
  const job = useListExport('activity')
  const filter = useMemo(() => filterOf(search), [search])

  const load = useCallback(() => {
    const ask = ++latest.current
    setView({ kind: 'loading' })
    setOpen(null)
    void read(filter, null).then(
      (page) => ask === latest.current && setView({ kind: 'ready', entries: page.entries, next: page.next, more: 'idle' }),
      () => ask === latest.current && setView({ kind: 'error' }),
    )
  }, [read, filter])
  useEffect(load, [load])

  const older = (shown: Extract<View, { kind: 'ready' }>, after: string) => {
    const ask = ++latest.current
    setView({ ...shown, more: 'loading' })
    void read(filter, after).then(
      (page) => ask === latest.current && setView({ kind: 'ready', entries: [...shown.entries, ...page.entries], next: page.next, more: 'idle' }),
      () => ask === latest.current && setView({ ...shown, more: 'failed' }),
    )
  }

  // Typing settles before it searches; the field keeps what is typed meanwhile.
  useEffect(() => setTyped(search.q ?? ''), [search.q])
  useEffect(() => {
    if (typed.trim() === (search.q ?? '')) return
    const timer = setTimeout(() => onSearch({ ...search, q: typed.trim() || undefined }), typingMs)
    return () => clearTimeout(timer)
  }, [typed, search, onSearch])

  const pickPerson = (entry: ActivityEntry) => {
    const person = personOf(entry)
    if (person) onSearch({ ...search, who: `${person.kind}:${person.id}`, whoName: actorOf(entry) })
  }

  // The person list offers who appears in what's loaded, and whoever is picked.
  const people = useMemo(() => {
    const seen = new Map<string, { name: string; label: string }>()
    if (search.who) seen.set(search.who, { name: search.whoName ?? search.who, label: search.whoName ?? search.who })
    if (view.kind === 'ready')
      for (const entry of view.entries) {
        const person = personOf(entry)
        if (person) seen.set(`${person.kind}:${person.id}`, { name: actorOf(entry), label: `${actorOf(entry)} · ${kindOf(entry.actor.kind)}` })
      }
    return [...seen]
  }, [view, search.who, search.whoName])

  const row = (entry: ActivityEntry) => {
    const actor = actorOf(entry)
    const done = doneOf(entry)
    const expanded = open === entry.id
    const link = targetLink(entry)
    const panel = `${id}-${entry.id}`
    return (
      <li key={entry.id} className="df-act-entry">
        <button type="button" className="df-act-row" aria-expanded={expanded} aria-controls={panel} onClick={() => setOpen(expanded ? null : entry.id)}>
          <span className={`df-act-av df-act-av--${entry.actor.kind}`} aria-hidden="true">
            {initials(actor).slice(0, 2)}
          </span>
          <span className="df-act-text">
            <span>
              <strong>{actor}</strong> {done}
            </span>
            <span className="df-act-muted">{kindOf(entry.actor.kind)}</span>
          </span>
          <span className={`df-act-result df-act-result--${entry.result}`}>{words.results[entry.result]}</span>
          <span className="df-act-muted df-act-when">{formatTime(entry.at)}</span>
        </button>
        {expanded && (
          <div id={panel} className="df-act-panel">
            {entry.changes.map((c) => (
              <span key={c.field}>{fill(words.change, { field: c.field, before: c.before ?? words.blank, after: c.after ?? words.blank })}</span>
            ))}
            {entry.reason && <span>{fill(words.reason, { reason: entry.reason })}</span>}
            {entry.through && <span className="df-act-muted">{fill((words.through as Record<string, string>)[entry.through.kind] ?? entry.through.kind, { partner: kindOf('support_session') })}</span>}
            {entry.onBehalfOf && entry.actor.kind !== 'support_session' && <span className="df-act-muted">{fill(words.onBehalf, { name: nameOf(entry.onBehalfOf.label) })}</span>}
            <span className="df-act-links">
              {personOf(entry) && (
                <button type="button" className="df-set-link" onClick={() => pickPerson(entry)}>
                  {fill(words.byPerson, { name: actor.split(' ')[0] ?? actor })}
                </button>
              )}
              {link && entry.target?.label && (
                <Link className="df-set-link" {...link}>
                  {fill(words.open, { target: nameOf(entry.target.label) })}
                </Link>
              )}
            </span>
          </div>
        )}
      </li>
    )
  }

  const body = () => {
    if (view.kind === 'loading') return <LoadingState label={words.loading} />
    if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
    const filtered = Boolean(search.who || search.what || search.q)
    if (view.entries.length === 0) return <EmptyState title={filtered ? words.none : words.empty} />
    return (
      <>
        <ul className="df-act-list" aria-label={words.listLabel}>
          {view.entries.map(row)}
        </ul>
        {view.more === 'failed' && (
          <p className="df-set-problem" role="alert">
            {words.moreFailed}
          </p>
        )}
        {view.next ? (
          <button type="button" className="df-button df-act-more" disabled={view.more === 'loading'} onClick={() => view.next && older(view, view.next)}>
            {words.more}
          </button>
        ) : (
          <p className="df-act-muted df-act-foot">{words.foot}</p>
        )}
      </>
    )
  }

  return (
    <div className="df-act">
      <div className="df-act-head">
        <div>
          <Heading className="df-act-title">{title}</Heading>
          <p className="df-set-sub">{words.sub}</p>
        </div>
        <span className="df-act-export">
          <button type="button" className="df-button" disabled={!canExport || sample || job?.state === 'preparing'} onClick={() => void startListExport('activity', requestActivityExport(filter))}>
            {words.export}
          </button>
          {!canExport && <span className="df-act-muted">{words.exportOwner}</span>}
        </span>
      </div>
      {job && (
        <p className="df-act-muted" role="status">
          <ExportJobStatus job={job} words={exportWords} />
        </p>
      )}
      <div className="df-act-filters">
        <div className="df-set-field">
          <label htmlFor={`${id}-who`}>{words.person}</label>
          <select
            id={`${id}-who`}
            value={search.who ?? ''}
            onChange={(event) => {
              const who = event.target.value
              onSearch({ ...search, who: who || undefined, whoName: who ? people.find(([key]) => key === who)?.[1].name : undefined })
            }}
          >
            <option value="">{words.everyone}</option>
            {people.map(([key, person]) => (
              <option key={key} value={key}>
                {person.label}
              </option>
            ))}
          </select>
        </div>
        <div className="df-set-field">
          <label htmlFor={`${id}-what`}>{words.what}</label>
          <select id={`${id}-what`} value={search.what ?? ''} onChange={(event) => onSearch({ ...search, what: activityWhats.find((w) => w === event.target.value) })}>
            <option value="">{words.whats.all}</option>
            {activityWhats.map((w) => (
              <option key={w} value={w}>
                {words.whats[w]}
              </option>
            ))}
          </select>
        </div>
        <div className="df-set-field">
          <label htmlFor={`${id}-q`}>{words.search}</label>
          <input id={`${id}-q`} type="search" value={typed} maxLength={searchMaxLength} placeholder={words.searchPlaceholder} onChange={(event) => setTyped(event.target.value)} />
        </div>
      </div>
      {search.who && (
        <p className="df-set-note df-act-person">
          <span>{fill(words.showing, { name: search.whoName ?? search.who })}</span>
          <button type="button" className="df-set-link" onClick={() => onSearch({ ...search, who: undefined, whoName: undefined })}>
            {words.clearPerson}
          </button>
        </p>
      )}
      {body()}
    </div>
  )
}
