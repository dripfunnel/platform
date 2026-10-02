import type { PartnerDomainRow, PartnerSetupItemRow, PlanRow } from '#db/schema/saas'

/** SAAS.md §3.2 step 3, in the order the consoles list them. */
export const goLiveChecks = ['portalHost', 'emailDomain', 'pricedPlan', 'legalPages', 'testSignup'] as const
export type GoLiveCheck = (typeof goLiveChecks)[number]

export type GoLiveChecks = Record<GoLiveCheck, boolean>

/**
 * Each check is a fact about the rows, never a stored flag. "Priced" means a Live plan until
 * PAPI 3 brings prices (noted on #33).
 */
export const goLiveChecksFor = (
  domains: readonly Pick<PartnerDomainRow, 'kind' | 'status'>[],
  items: readonly Pick<PartnerSetupItemRow, 'item' | 'status'>[],
  plans: readonly Pick<PlanRow, 'status'>[],
  fallbackSenderAccepted: boolean,
): GoLiveChecks => {
  const live = (kind: PartnerDomainRow['kind']) => domains.some((d) => d.kind === kind && d.status === 'live')
  const done = (item: PartnerSetupItemRow['item']) => items.some((i) => i.item === item && i.status === 'done')
  return {
    portalHost: live('portal'),
    emailDomain: live('email') || fallbackSenderAccepted,
    pricedPlan: plans.some((p) => p.status === 'live'),
    legalPages: done('legal'),
    testSignup: done('testSignup'),
  }
}

export const failingChecks = (checks: GoLiveChecks): GoLiveCheck[] => goLiveChecks.filter((check) => !checks[check])
