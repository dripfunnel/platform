import { StatusPill } from '@dripfunnel/shared/ui'
import type { Partner, PartnerPlan } from '../../api/partners'
import { fill, formatCount, messages } from '../../messages'
import { InfoNote } from '@dripfunnel/shared/ui'
import './partners.css'

const words = messages.partner

const statusLook = {
  live: { tone: 'success', icon: 'ok' },
  draft: { tone: 'neutral', icon: 'pen' },
  retired: { tone: 'neutral', icon: 'ban' },
} as const

const limitsOf = (plan: PartnerPlan) => {
  if (plan.maxProducts === null && plan.maxStaff === null) return words.plans.limitsNotSet
  const products = plan.maxProducts === null ? words.plans.unlimitedProducts : fill(words.plans.products, { count: formatCount(plan.maxProducts) })
  const staff = plan.maxStaff === null ? words.plans.unlimitedStaff : fill(words.plans.staff, { count: formatCount(plan.maxStaff) })
  return `${products} · ${staff}`
}

// Prices arrive with the plans card (decided on #33); until then the table shows each plan's status.
export const PlansTab = ({ partner }: { partner: Partner }) => (
  <div className="df-panels">
    <InfoNote>{words.readOnlyEdited}</InfoNote>
    {partner.plans.length === 0 ? (
      <p className="df-muted">{words.plans.none}</p>
    ) : (
      <div className="df-table-scroll df-panel--wide" role="region" aria-label={words.tabs.plans} tabIndex={0}>
        <table className="df-table">
          <thead>
            <tr>
              <th scope="col">{words.plans.plan}</th>
              <th scope="col">{words.plans.status}</th>
              <th scope="col">{words.plans.limits}</th>
              <th scope="col" className="df-number">
                {words.plans.stores}
              </th>
            </tr>
          </thead>
          <tbody>
            {partner.plans.map((plan) => (
              <tr key={plan.id}>
                <th scope="row">{plan.name}</th>
                <td>
                  <StatusPill {...statusLook[plan.status]} label={words.plans.statuses[plan.status]} />
                </td>
                <td className="df-muted">{limitsOf(plan)}</td>
                <td className="df-number">{formatCount(plan.stores)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)
