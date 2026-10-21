import { maxPageSize, type ScopedSql } from './index'

// The partner's live plans for its own pricing page (SAAS.md §6.1, #459). `system` scope: the reader
// is anonymous, so only published columns are selected and every query names the partner.

export interface PricingPlanRow {
  id: string
  name: string
  description: string | null
  trial_days: number
}

/** Live plans only, with the current version's trial; in the portal's plan order (name), capped as one page. */
export const selectPricingPlans = (tx: ScopedSql, partnerId: string): Promise<PricingPlanRow[]> =>
  tx<PricingPlanRow[]>`
    select p.id, p.name, p.description, v.trial_days
    from plan p join plan_version v on v.plan_id = p.id and v.version = p.version
    where p.partner_id = ${partnerId} and p.status = 'live'
    order by p.name, p.id limit ${maxPageSize}
  `
