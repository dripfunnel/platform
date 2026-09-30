import type { ReactNode } from 'react'
import type { Store } from '../../api/stores'
import { formatTime, messages } from '../../messages'
import { LiveLink, StorefrontPill } from './storeLook'

const words = messages.store.storefront

// An own storefront is the merchant's: its addresses are shown, never linked.
export const StorefrontTab = ({ store }: { store: Store }) => {
  const { site } = store
  const own = store.storefront === 'own'
  const address = (host: string) => (own ? <code className="df-host">{host}</code> : <LiveLink host={host} />)
  const rows: [string, ReactNode][] = [
    [words.type, own ? words.own : words.ai],
    [words.version, site.version ?? words.none],
    [words.lastBuild, site.lastBuildAt ? formatTime(site.lastBuildAt) : words.none],
    [words.lastPublish, site.lastPublishAt ? formatTime(site.lastPublishAt) : words.none],
    [words.live, address(store.domain.host)],
    ...(site.previewHost ? [[words.preview, address(site.previewHost)] as [string, ReactNode]] : []),
  ]
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="store-storefront">
        <div className="df-panel-head">
          <h2 id="store-storefront">{words.title}</h2>
          <StorefrontPill storefront={store.storefront} />
        </div>
        <dl className="df-facts">{rows.flatMap(([label, value]) => [<dt key={`${label}-label`}>{label}</dt>, <dd key={label}>{value}</dd>])}</dl>
      </section>
    </div>
  )
}
