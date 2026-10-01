import { harnessEnabled } from '../harness'
import type { NavBadgeSource } from '../nav'
import type { PartnerState } from './me'

export type NavBadges = Record<NavBadgeSource, number>

const none: NavBadges = { storesAttention: 0, brandingSetupLeft: 0, domainsWaiting: 0, billingFailedPayments: 0, supportOpenSessions: 0 }

// Seam: no Platform API query returns these counts yet (FIRST-RELEASE.md §16 lists them under
// the shell); until it does, the harness shows the prototype's numbers so every badge is seen.
export const loadNavBadges = (partnerState: PartnerState): Promise<NavBadges> =>
  Promise.resolve(
    harnessEnabled
      ? { storesAttention: 2, brandingSetupLeft: partnerState === 'live' ? 0 : 1, domainsWaiting: 1, billingFailedPayments: 1, supportOpenSessions: 1 }
      : none,
  )
