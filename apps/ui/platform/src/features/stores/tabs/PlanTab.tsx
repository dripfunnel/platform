import type { Store, StoreAction } from '../../../api/stores'
import { fill, formatAmount, formatCount, formatDate, messages } from '../../../messages'
import { UsageBar } from '../../common/UsageBar'
import { StoreActionButton } from '../StoreActions'
import { chargedByOf, planNameOf } from '../storeLook'

const words = messages.store.plan

// Plan and limits (§6.3): the plan with Change plan, a bar per limit from the API's percent, the overrides.
export const PlanTab = ({ store, onAction }: { store: Store; onAction: (action: StoreAction) => void }) => (
  <div className="df-panels">
    <section className="df-panel" aria-labelledby="store-plan">
      <div className="df-panel-head">
        <div className="df-stack">
          <h2 id="store-plan">{planNameOf(store.plan)}</h2>
          {store.planPrice && <span className="df-muted">{fill(words.price, { price: formatAmount(store.planPrice), who: chargedByOf(store.billing.mode, store.billing.partnerName) })}</span>}
        </div>
        <StoreActionButton store={store} action="changePlan" onAction={onAction} />
      </div>
      <ul className="df-usage-list">
        {store.usage.map((usage) => (
          <li key={usage.limit}>
            <div className="df-usage-line">
              <span>
                <strong>{words.limits[usage.limit]}</strong> {usage.monthly && <span className="df-muted">{words.thisMonth}</span>}
              </span>
              <span className="df-usage-figures">
                {usage.percent !== null && usage.percent >= 80 && <span className="df-near">{usage.percent >= 100 ? words.at : words.near}</span>}
                <span className="df-muted">{usage.cap === null ? fill(words.notIncluded, { used: formatCount(usage.used) }) : fill(words.used, { used: formatCount(usage.used), cap: formatCount(usage.cap) })}</span>
              </span>
            </div>
            <UsageBar percent={usage.percent ?? 0} />
          </li>
        ))}
      </ul>
    </section>
    <section className="df-panel" aria-labelledby="store-overrides">
      <div className="df-panel-head">
        <h2 id="store-overrides">{words.overrides}</h2>
        <StoreActionButton store={store} action="addOverride" label={words.addOverride} onAction={onAction} />
      </div>
      {store.overrides.length === 0 ? (
        <p className="df-muted">{words.noOverrides}</p>
      ) : (
        <ul className="df-rows df-rows--stacked">
          {store.overrides.map((override) => (
            <li key={override.id}>
              <strong>{fill(override.duration === 'always' ? words.overrideAlways : words.overrideMonth, { amount: formatCount(override.amount), limit: words.limits[override.limit] })}</strong>
              <span>{override.reason}</span>
              <span className="df-muted">{fill(words.overrideBy, { by: override.by, date: formatDate(override.at) })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
)
