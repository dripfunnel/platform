import { useId } from 'react'
import type { StorefrontMeters } from '../../api/storefront'
import { fill, formatCount, formatTime, messages } from '../../messages'

const words = messages.storefront.usage

/** Site settings › AI and build minutes (PortalStorefront): this month's meters, the counts and the recent requests. */
export const UsageCard = ({ usage }: { usage: StorefrontMeters['usage'] }) => {
  const titleId = useId()
  const allowed = usage.ownKey ? null : usage.aiPromptsAllowed
  const share = allowed ? Math.min(100, (usage.aiPromptsUsed / allowed) * 100) : 0
  return (
    <section className="df-sf-card" aria-labelledby={titleId}>
      <div className="df-sf-card-head">
        <h2 id={titleId}>{words.title}</h2>
        <p className="df-sf-lede">{words.lede}</p>
      </div>
      {allowed !== null && (
        <div className="df-sf-meter">
          <span>
            <span>{words.requests}</span>
            <strong className={share >= 80 ? 'df-sf-meter-high' : undefined}>{fill(words.of, { used: formatCount(usage.aiPromptsUsed), allowed: formatCount(allowed) })}</strong>
          </span>
          <progress max={allowed} value={Math.min(usage.aiPromptsUsed, allowed)} aria-label={words.requests} />
        </div>
      )}
      <dl className="df-sf-stats">
        {[
          [usage.aiRequests, words.requestsStat],
          [usage.buildMinutes, words.buildMinutes],
          [usage.publishesLast30Days, words.publishesStat],
        ].map(([value, label]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{formatCount(Number(value))}</dd>
          </div>
        ))}
      </dl>
      {usage.recent.length > 0 && (
        <div className="df-sf-recent">
          <h3>{words.recent}</h3>
          <ul>
            {usage.recent.map((r) => (
              <li key={r.id}>
                <span>{r.text}</span>
                <span>{formatTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="df-sf-lede">{usage.ownKey ? words.ownKey : words.note}</p>
    </section>
  )
}
