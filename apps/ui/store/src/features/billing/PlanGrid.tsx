import { useId, useState } from 'react'
import type { BillingInterval, CataloguePlan, Subscription } from '../../api/billing'
import { fill, messages } from '../../messages'
import { dayOf, includesRows, isFree, isUpgrade, money, planPoints, priceOf } from './billingView'

const words = messages.billing.plans
const includes = messages.billing.includes

type Action = { label: string; primary: boolean } | null

/** The button a plan's card offers; the API decides what the change is and refuses what it can't be. */
const actionOf = (plan: CataloguePlan, sub: Subscription, interval: BillingInterval, current: CataloguePlan | undefined): Action => {
  if (!priceOf(plan, interval) || isFree(plan)) return null
  if (sub.status === 'trial') return { label: fill(words.choose, { plan: plan.name }), primary: true }
  if (plan.current) {
    if (interval !== sub.interval) return { label: words.switchTo[interval], primary: interval === 'YEAR' }
    return sub.scheduled ? { label: fill(words.keep, { plan: plan.name }), primary: true } : null
  }
  if (sub.scheduled?.plan.id === plan.id && sub.scheduled.interval === interval) return null
  return isUpgrade(plan, current) ? { label: words.upgrade, primary: true } : { label: words.later, primary: false }
}

const tagOf = (plan: CataloguePlan, sub: Subscription): { text: string; current: boolean } | null => {
  if (plan.current) return { text: sub.status === 'trial' ? words.trial : words.yours, current: true }
  if (sub.scheduled?.plan.id === plan.id) return { text: fill(words.from, { date: dayOf(sub.scheduled.at) }), current: false }
  return null
}

export interface PlanGridProps {
  plans: readonly CataloguePlan[]
  sub: Subscription
  interval: BillingInterval
  canChange: boolean
  /** The plan whose quote is being read. */
  pending: string | null
  onPick: (plan: CataloguePlan) => void
}

/** The partner's plans, each with its price for the period shown and its limits (decided on #337: plans show their limits and quotas). */
export const PlanGrid = ({ plans, sub, interval, canChange, pending, onPick }: PlanGridProps) => {
  const [open, setOpen] = useState(false)
  const tableId = useId()
  const current = plans.find((p) => p.current)
  if (plans.length === 0) return <p className="df-billing-note">{fill(words.none, { partner: sub.partnerName })}</p>
  return (
    <section className="df-billing-plans" aria-label={words.label}>
      <div className="df-billing-plan-grid">
        {plans.map((plan) => {
          const price = priceOf(plan, interval)
          const tag = tagOf(plan, sub)
          const action = canChange ? actionOf(plan, sub, interval, current) : null
          return (
            <article key={plan.id} className={plan.current ? 'df-billing-plan df-billing-plan--current' : 'df-billing-plan'} aria-label={plan.name}>
              <div className="df-billing-plan-head">
                <h2>{plan.name}</h2>
                {tag && <span className={tag.current ? 'df-billing-tag df-billing-tag--current' : 'df-billing-tag'}>{tag.text}</span>}
              </div>
              <p className="df-billing-price">
                {price ? (
                  <>
                    <strong>{isFree(plan) ? words.free : money(price)}</strong> {!isFree(plan) && <span>{words.per[interval]}</span>}
                  </>
                ) : (
                  <span>{words.notOffered[interval]}</span>
                )}
              </p>
              <p className="df-billing-note df-billing-plan-note">{plan.description ?? words.billed[interval]}</p>
              <ul className="df-billing-points">
                {planPoints(plan).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {action && (
                <button type="button" className={action.primary ? 'df-button df-button--primary' : 'df-button'} disabled={pending !== null} aria-busy={pending === plan.id} onClick={() => onPick(plan)}>
                  {action.label}
                </button>
              )}
            </article>
          )
        })}
      </div>
      <button type="button" className="df-billing-link" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((o) => !o)}>
        {open ? includes.hide : includes.show}
      </button>
      <div id={tableId} className="df-billing-includes" hidden={!open}>
        <table>
          <caption className="df-visually-hidden">{includes.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{includes.setting}</th>
              {plans.map((p) => (
                <th key={p.id} scope="col">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {includesRows(plans).map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {row.cells.map((cell, i) => (
                  <td key={plans[i]?.id ?? i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
