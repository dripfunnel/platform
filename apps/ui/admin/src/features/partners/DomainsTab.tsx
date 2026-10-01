import { useState } from 'react'
import type { DomainKind, Partner, PartnerDomain } from '../../api/partners'
import { fill, messages } from '../../messages'
import { InfoNote } from '../common/InfoNote'
import { HostPill } from './partnerLook'
import './partners.css'

const words = messages.partner.domains

export interface DomainsTabProps {
  partner: Partner
  onRecheck: (domain: PartnerDomain) => Promise<void>
}

const keyOf = (domain: PartnerDomain) => `${domain.kind}:${domain.host}`

export const DomainsTab = ({ partner, onRecheck }: DomainsTabProps) => {
  const [checking, setChecking] = useState<string | null>(null)
  if (partner.domains.length === 0) return <p className="df-muted">{words.none}</p>
  return (
    <div className="df-panels">
      <InfoNote>{words.note}</InfoNote>
      {partner.domains.map((domain) => {
        const key = keyOf(domain)
        const kind: DomainKind = domain.kind
        return (
          <section key={key} className="df-panel df-panel--wide" aria-label={`${words.kinds[kind]} · ${domain.host}`}>
            <div className="df-panel-head">
              <div className="df-stack">
                <h2>{words.kinds[kind]}</h2>
                <code className="df-host">{domain.host}</code>
              </div>
              <div className="df-domain-status">
                <HostPill status={domain.status} />
                <button
                  type="button"
                  className="df-button"
                  disabled={checking === key}
                  aria-label={fill(words.recheckLabel, { host: domain.host })}
                  onClick={() => {
                    setChecking(key)
                    void onRecheck(domain).finally(() => setChecking(null))
                  }}
                >
                  {checking === key ? words.checking : words.recheck}
                </button>
              </div>
            </div>
            <dl className="df-facts">
              <dt>{words.record}</dt>
              <dd>
                <code>{domain.record}</code>
              </dd>
              <dt>{words.expected}</dt>
              <dd>
                <code>{domain.expected}</code>
              </dd>
              <dt>{words.found}</dt>
              <dd className={domain.status === 'live' ? undefined : 'df-found--wrong'}>
                {domain.found ? <code>{domain.found}</code> : words.nothingFound}
              </dd>
            </dl>
          </section>
        )
      })}
    </div>
  )
}
