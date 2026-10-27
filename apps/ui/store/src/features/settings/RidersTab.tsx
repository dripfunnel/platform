import { initials } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import type { PageOf } from '../../api/allPages'
import { loadRiders, type Rider, type RiderStatus } from '../../api/riders'
import { fill, formatCount, messages } from '../../messages'
import '../common/teamRow.css'
import './riders.css'

const words = messages.settings.riders

const tones: Record<RiderStatus, string> = { active: 'ok', invited: 'wait', suspended: 'off' }

export interface RidersTabProps {
  first: PageOf<Rider>
}

/** SetRiders: the Owner's own delivery people, read only here; the writes come in the next part of #844. */
export const RidersTab = ({ first }: RidersTabProps) => {
  const [page, setPage] = useState(first)
  const [more, setMore] = useState<'idle' | 'busy' | 'failed'>('idle')
  const riders = page.nodes

  const showMore = async () => {
    if (!page.pageInfo.endCursor) return
    setMore('busy')
    try {
      const next = await loadRiders(page.pageInfo.endCursor)
      setPage({ nodes: [...page.nodes, ...next.nodes], pageInfo: next.pageInfo })
      setMore('idle')
    } catch {
      setMore('failed')
    }
  }

  return (
    <div className="df-team">
      <div className="df-team-head">
        <div>
          <h2>{words.title}</h2>
          <p>{words.sub}</p>
        </div>
      </div>
      {riders.length === 0 ? (
        <div className="df-riders-empty">
          <h3>{words.emptyTitle}</h3>
          <p>{words.emptyBody}</p>
        </div>
      ) : (
        <div className="df-team-list">
          <div className="df-riders-head" aria-hidden="true">
            <span>{words.columns.rider}</span>
            <span>{words.columns.status}</span>
            <span>{words.columns.online}</span>
            <span>{words.columns.current}</span>
            <span>{words.columns.done}</span>
          </div>
          <ul aria-label={words.title} className="df-riders-list">
            {riders.map((r) => (
              <li key={r.id} className="df-team-row df-riders-row">
                <span className="df-team-who">
                  <span className="df-team-mark" aria-hidden="true">
                    {initials(r.name) || '?'}
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <span>{r.phone ?? ''}</span>
                  </span>
                </span>
                <span className={`df-team-status df-team-status--${tones[r.status]}`}>
                  <span className="df-visually-hidden">{words.columns.status}: </span>
                  {words.statuses[r.status]}
                </span>
                {r.status === 'active' ? (
                  <span className="df-riders-online" data-on={r.online}>
                    <span className="df-visually-hidden">{words.columns.online}: </span>
                    {r.online ? words.online : words.offline}
                  </span>
                ) : (
                  <span className="df-riders-quiet">{words.none}</span>
                )}
                <span className={r.currentDeliveryId ? undefined : 'df-riders-quiet'}>
                  <span className="df-visually-hidden">{words.columns.current}: </span>
                  {r.currentDeliveryId ? words.onDelivery : words.noDelivery}
                </span>
                <span className="df-riders-done">
                  <span className="df-visually-hidden">{words.columns.done}: </span>
                  {fill(words.delivered, { count: formatCount(r.deliveriesDone) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {page.pageInfo.hasNextPage && (
        <div>
          <button type="button" className="df-button" disabled={more === 'busy'} onClick={() => void showMore()}>
            {words.showMore}
          </button>
          {more === 'failed' && (
            <p role="alert" className="df-team-foot">
              {words.moreFailed}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
