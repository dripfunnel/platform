import { StatusPill } from '@dripfunnel/shared/ui'
import type { Store } from '../../api/stores'
import { messages } from '../../messages'

const words = messages.store.support

// Read-only: only the merchant changes it, in their portal (decided on #20).
export const SupportTab = ({ store }: { store: Store }) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-labelledby="store-support">
      <div className="df-panel-head">
        <h2 id="store-support">{words.title}</h2>
        <span className="df-muted">{words.sub}</span>
      </div>
      <StatusPill
        tone={store.supportAccess ? 'success' : 'neutral'}
        icon={store.supportAccess ? 'ok' : 'ban'}
        label={store.supportAccess ? words.on : words.off}
      />
    </section>
  </div>
)
