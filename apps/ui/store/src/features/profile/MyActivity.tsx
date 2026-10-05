import { activityResultLook, StatusPill } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useState } from 'react'
import { loadMyActivity, type MyActivityEntry } from '../../api/profile'
import { formatTime, messages } from '../../messages'
import { Card, Secondary } from './parts'
import { activityLine } from './profileWords'

const words = messages.profile.activity

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; entries: MyActivityEntry[]; next: string | null; more: 'idle' | 'loading' | 'error' }

// "Your activity" (LOGGING §6 "own activity", FIRST-RELEASE §4): what was done under the person's name in
// this partner's stores, a page at a time. Not drawn in PortalProfile; it takes StoreActivity's rows.
export const MyActivity = ({ storeNames, sample }: { storeNames: ReadonlyMap<string, string>; sample?: readonly MyActivityEntry[] | undefined }) => {
  const [view, setView] = useState<View>(sample ? { kind: 'ready', entries: [...sample], next: null, more: 'idle' } : { kind: 'loading' })

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

  const older = (ready: Extract<View, { kind: 'ready' }>) => {
    // One page at a time: the button is gone while it loads, so a double click can't fetch it twice.
    if (ready.more === 'loading') return
    setView({ ...ready, more: 'loading' })
    loadMyActivity(ready.next).then(
      (page) => setView({ kind: 'ready', entries: [...ready.entries, ...page.entries], next: page.next, more: 'idle' }),
      () => setView({ ...ready, more: 'error' }),
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
