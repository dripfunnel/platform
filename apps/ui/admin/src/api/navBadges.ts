import { z } from 'zod'
import type { NavBadgeSource } from '../nav'
import { query } from './client'

export type NavBadges = Record<NavBadgeSource, number>

const count = z.number().int().nonnegative()

const badgesSchema = z.object({
  navBadges: z.object({ partnersAwaitingApproval: count, provisioningAttention: count, openSessions: count.nullable() }),
})

// `openSessions` is null for a role the API keeps it from (FIRST-RELEASE.md §2); nav.ts shows
// that badge to no such role, so the count it never sees is zero.
export const loadNavBadges = async (): Promise<NavBadges> => {
  const { navBadges } = await query(`{ navBadges { partnersAwaitingApproval provisioningAttention openSessions } }`, badgesSchema)
  return { ...navBadges, openSessions: navBadges.openSessions ?? 0 }
}
