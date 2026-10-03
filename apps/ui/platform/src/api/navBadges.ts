import { z } from 'zod'
import type { NavBadgeSource } from '../nav'
import { query } from './client'

export type NavBadges = Record<NavBadgeSource, number>

const count = z.number().int().nonnegative()

const badgesSchema = z.object({
  navBadges: z.object({ storesAttention: count, brandingSetupLeft: count, domainsWaiting: count, billingFailedPayments: count, supportOpenSessions: count }),
})

// The menu's work-waiting counts (FIRST-RELEASE.md §2.1, §16), all the API's.
export const loadNavBadges = async (): Promise<NavBadges> =>
  (await query(`{ navBadges { storesAttention brandingSetupLeft domainsWaiting billingFailedPayments supportOpenSessions } }`, badgesSchema)).navBadges
