import type { Store } from '../../../api/stores'
import { fill, formatTime, messages } from '../../../messages'
import { DomainLink, StorefrontPill } from '../storeLook'

const words = messages.store.storefront

// Storefront (§6.3): read-only; the merchant designs and publishes their shop.
export const StorefrontTab = ({ store }: { store: Store }) => (
  <div className="df-panels">
    <section className="df-panel" aria-labelledby="store-storefront">
      <div className="df-panel-head">
        <h2 id="store-storefront">{words.title}</h2>
        <StorefrontPill storefront={store.storefront} />
      </div>
      {store.storefront === 'own' && <p>{fill(words.own, { name: store.name })}</p>}
      <dl className="df-facts">
        <dt>{words.live}</dt>
        <dd>
          <DomainLink host={store.domain.host} />
        </dd>
        <dt>{words.preview}</dt>
        <dd>
          <DomainLink host={store.site.previewHost} />
        </dd>
        <dt>{words.lastPublish}</dt>
        <dd>{store.site.lastPublishAt ? formatTime(store.site.lastPublishAt) : words.notPublished}</dd>
      </dl>
      <p className="df-muted">{words.readOnly}</p>
    </section>
  </div>
)
