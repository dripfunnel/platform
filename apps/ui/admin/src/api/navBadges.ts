import { harnessEnabled } from '../harness'
import type { NavBadgeSource } from '../nav'
import { impersonationServer } from './impersonationSample'
import { sampleServer } from './partnersSample'
import { provisioningServer } from './provisioningSample'

export type NavBadges = Record<NavBadgeSource, number>

const none: NavBadges = { partnersAwaitingApproval: 0, provisioningAttention: 0, openSessions: 0 }

// Seam: no Admin API query returns these counts yet (FIRST-RELEASE.md §12 names none); the
// pull request lists them as fields the API needs. Under the ?state= harness they are counted
// from the samples, so a Retry or an Undo moves the badge.
export const loadNavBadges = (): Promise<NavBadges> =>
  Promise.resolve(
    harnessEnabled
      ? {
          partnersAwaitingApproval: sampleServer.list({ status: 'awaiting' }, {}, 1, 'staff-read-only').total,
          provisioningAttention: provisioningServer.needingAttention(),
          openSessions: impersonationServer.openCount(),
        }
      : none,
  )
