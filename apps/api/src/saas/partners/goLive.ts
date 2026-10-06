import type { PartnerDomainRow, PartnerSetupItemRow, PlanRow } from '#db/schema/saas'

/** SAAS.md §3.2 step 3, in the order the consoles list them. */
export const goLiveChecks = ['portalHost', 'emailDomain', 'pricedPlan', 'legalPages'] as const
export type GoLiveCheck = (typeof goLiveChecks)[number]

export type GoLiveChecks = Record<GoLiveCheck, boolean>

/** Each check is a fact about the rows, never a stored flag. "Priced": a Live plan whose current version has a price (#157). */
export const goLiveChecksFor = (
  domains: readonly Pick<PartnerDomainRow, 'kind' | 'status'>[],
  items: readonly Pick<PartnerSetupItemRow, 'item' | 'status'>[],
  plans: readonly (Pick<PlanRow, 'status'> & { priced: boolean })[],
  fallbackSenderAccepted: boolean,
): GoLiveChecks => {
  const live = (kind: PartnerDomainRow['kind']) => domains.some((d) => d.kind === kind && d.status === 'live')
  const done = (item: PartnerSetupItemRow['item']) => items.some((i) => i.item === item && i.status === 'done')
  return {
    portalHost: live('portal'),
    emailDomain: live('email') || fallbackSenderAccepted,
    pricedPlan: plans.some((p) => p.status === 'live' && p.priced),
    legalPages: done('legal'),
  }
}

export const failingChecks = (checks: GoLiveChecks): GoLiveCheck[] => goLiveChecks.filter((check) => !checks[check])
