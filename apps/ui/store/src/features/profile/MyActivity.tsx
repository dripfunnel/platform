import { activityResultLook, StatusPill } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useState } from 'react'
import { loadMyActivity, type MyActivityEntry } from '../../api/profile'
import { formatTime, messages } from '../../messages'
import { Card, Secondary } from './parts'
import { activityLine } from './profileWords'

const words = messages.profile.activity

export type ActivityView = { kind: 'loading' } | { kind: 'error' } | Ready
type Ready = { kind: 'ready'; entries: MyActivityEntry[]; next: string | null; more: 'idle' | 'loading' | 'error' }

/** The next page's request, or null while one is loading or none is left: a double click asks once. */
export const startOlder = (view: Ready): Ready | null => (view.more === 'loading' || view.next === null ? null : { ...view, more: 'loading' })

/** A page arrived: its rows follow those shown, never twice, and the cursor moves on. */
export const olderLoaded = (view: Ready, page: { entries: MyActivityEntry[]; next: string | null }): Ready => {
  const shown = new Set(view.entries.map((e) => e.id))
  return { kind: 'ready', entries: [...view.entries, ...page.entries.filter((e) => !shown.has(e.id))], next: page.next, more: 'idle' }
}

/** A page failed: what is shown stays, with the error and the same cursor to try again. */
export const olderFailed = (view: Ready): Ready => ({ ...view, more: 'error' })

// "Your activity" (LOGGING §6 "own activity", FIRST-RELEASE §4): what was done under the person's name in
// this partner's stores, a page at a time. Not drawn in PortalProfile; it takes StoreActivity's rows.
export const MyActivity = ({ storeNames, sample }: { storeNames: ReadonlyMap<string, string>; sample?: readonly MyActivityEntry[] | undefined }) => {
  const [view, setView] = useState<ActivityView>(sample ? { kind: 'ready', entries: [...sample], next: null, more: 'idle' } : { kind: 'loading' })

  const first = useCallback(() => {
    setView({ kind: 'loading' })
    loadMyActivity(null).then(
      (page) => setView({ kind: 'ready', entries: page.entries, next: page.next, more: 'idle' }),
      () => setView({ kind: 'error' }),
    )
  }, [])

  useEffect(() => {
    if (!sample) first()
  }, [sample, first])

  const older = (ready: Ready) => {
    const loading = startOlder(ready)
    if (!loading) return
    setView(loading)
    loadMyActivity(ready.next).then(
      (page) => setView(olderLoaded(loading, page)),
      () => setView(olderFailed(loading)),
    )
  }

  return (
    <Card title={words.title} sub={words.sub}>
      {view.kind === 'loading' && <p className="df-profile-note">{words.loading}</p>}
      {view.kind === 'error' && (
        <div className="df-profile-inline">
          <p role="alert" className="df-profile-alert">
            {words.error}
          </p>
          <Secondary size="small" onClick={first}>
            {words.retry}
          </Secondary>
        </div>
      )}
      {view.kind === 'ready' && view.entries.length === 0 && <p className="df-profile-note">{words.empty}</p>}
      {view.kind === 'ready' && view.entries.length > 0 && (
        <>
          <ul className="df-profile-activity">
            {view.entries.map((entry) => {
              const store = entry.storeId ? storeNames.get(entry.storeId) : undefined
              return (
                <li key={entry.id}>
                  <span className="df-profile-row-text">
                    <strong>{activityLine(entry)}</strong>
                    <span>{store ? `${formatTime(entry.occurredAt)} · ${store}` : formatTime(entry.occurredAt)}</span>
                  </span>
                  <StatusPill {...activityResultLook[entry.result]} label={words.results[entry.result]} />
                </li>
              )
            })}
          </ul>
          {view.more === 'error' && (
            <p role="alert" className="df-profile-alert">
              {words.error}
            </p>
          )}
          {view.more === 'loading' && <p className="df-profile-note">{words.loading}</p>}
          {view.next && view.more !== 'loading' && (
            <div>
              <Secondary size="small" onClick={() => older(view)}>
                {words.more}
              </Secondary>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
