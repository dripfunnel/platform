import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import type { Store, StoreDomain } from '../../../api/stores'
import { fill, formatDate, messages } from '../../../messages'

const words = messages.store.domains

const domainLook: Record<StoreDomain['status'], { tone: StatusTone; icon: StatusIconName }> = {
  live: { tone: 'success', icon: 'ok' },
  waiting: { tone: 'warning', icon: 'hour' },
  failed: { tone: 'danger', icon: 'cross' },
}

// Domains (§6.3): the custom domain, its status, the CNAME record with Copy and what we found, Re-check now.
export const DomainsTab = ({ store, product, onRecheck }: { store: Store; product: string; onRecheck: () => Promise<void> }) => {
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const { domain } = store
  // Since when the custom domain has waited for its record, from the API's record.
  const waitingSince = store.records.find((record) => record.status !== 'live')?.since ?? null
  if (!domain) return <p className="df-muted">{fill(words.shopAddress, { product })}</p>
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="store-domain">
        <div className="df-panel-head">
          <div className="df-stack">
            <h2 id="store-domain">{domain.host}</h2>
            {waitingSince && <span className="df-muted">{fill(words.waitingSince, { date: formatDate(waitingSince) })}</span>}
          </div>
          <div className="df-domain-actions">
            <StatusPill {...domainLook[domain.status]} label={words.status[domain.status]} />
            {domain.status !== 'live' && (
              <button
                type="button"
                className="df-button"
                disabled={checking}
                onClick={() => {
                  setChecking(true)
                  void onRecheck().finally(() => setChecking(false))
                }}
              >
                {checking ? words.checking : words.recheck}
              </button>
            )}
          </div>
        </div>
        {domain.custom ? <p>{words.explain}</p> : <p className="df-muted">{fill(words.shopAddress, { product })}</p>}
        {store.records.map((record) => (
          <dl key={record.name} className="df-record">
            <div>
              <dt>{words.type}</dt>
              <dd>
                <strong>{record.type}</strong>
              </dd>
            </div>
            <div>
              <dt>{words.name}</dt>
              <dd>
                <code>{record.name}</code>
              </dd>
            </div>
            <div>
              <dt>{words.value}</dt>
              <dd className="df-record-value">
                <code>{record.value}</code>
                <button
                  type="button"
                  className="df-button df-button--small"
                  aria-label={words.copyLabel}
                  onClick={() => {
                    void navigator.clipboard?.writeText(record.value).then(() => setCopied(true))
                  }}
                >
                  {words.copy}
                </button>
                <span role="status" className="df-visually-hidden">
                  {copied ? words.copied : ''}
                </span>
              </dd>
            </div>
            <div>
              <dt>{words.found}</dt>
              <dd>{record.found ? <code>{record.found}</code> : <span className="df-muted">{words.nothingFound}</span>}</dd>
            </div>
          </dl>
        ))}
      </section>
    </div>
  )
}
