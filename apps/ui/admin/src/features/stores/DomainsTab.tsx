import { useState } from 'react'
import type { Store, StoreDnsRecord } from '../../api/stores'
import { fill, messages } from '../../messages'
import { DomainPill } from './storeLook'
import './stores.css'
import '../common/records.css'

const words = messages.store.domains

export interface DomainsTabProps {
  store: Store
  onRecheck: (record: StoreDnsRecord) => Promise<void>
}

const expectedText = (record: StoreDnsRecord, partner: string) => record.expected ?? fill(words.coveredBy, { partner })

const foundText = (record: StoreDnsRecord) => {
  if (record.found === null) return words.nothingFound
  return record.kind === 'shopAddress' ? words.covered : record.found
}

// The prototype's Domains tab: each record the store's addresses need, expected against found.
export const DomainsTab = ({ store, onRecheck }: DomainsTabProps) => {
  const [checking, setChecking] = useState<string | null>(null)
  return (
    <div className="df-panels">
      <p className="df-muted df-panel--wide">{store.domain.custom ? words.noteCustom : words.noteShop}</p>
      <ul className="df-records df-panel--wide">
        {store.records.map((record) => (
          <li key={record.host}>
            <section className="df-panel" aria-label={`${words.kinds[record.kind]} · ${record.host}`}>
              <div className="df-panel-head">
                <div className="df-stack">
                  <h2>{words.kinds[record.kind]}</h2>
                  <code className="df-host">{record.host}</code>
                </div>
                <div className="df-domain-status">
                  <DomainPill status={record.status} />
                  <button
                    type="button"
                    className="df-button"
                    disabled={checking === record.host}
                    aria-label={fill(words.recheckLabel, { host: record.host })}
                    onClick={() => {
                      setChecking(record.host)
                      void onRecheck(record).finally(() => setChecking(null))
                    }}
                  >
                    {checking === record.host ? words.checking : words.recheck}
                  </button>
                </div>
              </div>
              <dl className="df-facts">
                <dt>{words.record}</dt>
                <dd>{record.record ? <code>{record.record}</code> : words.noRecord}</dd>
                <dt>{words.expected}</dt>
                <dd>{record.expected ? <code>{record.expected}</code> : expectedText(record, store.partner.name)}</dd>
                <dt>{words.found}</dt>
                <dd className={record.status === 'live' ? undefined : 'df-found--wrong'}>
                  {record.found && record.kind !== 'shopAddress' ? <code>{record.found}</code> : foundText(record)}
                </dd>
              </dl>
            </section>
          </li>
        ))}
      </ul>
    </div>
  )
}
