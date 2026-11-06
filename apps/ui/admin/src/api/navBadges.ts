import { z } from 'zod'
import type { NavBadgeSource } from '../nav'
import { query } from './client'

export type NavBadges = Record<NavBadgeSource, number>

const count = z.number().int().nonnegative()

const badgesSchema = z.object({
  navBadges: z.object({ partnersAwaitingApproval: count, provisioningAttention: count, openSessions: count.nullable(), pausedRollouts: count.nullable() }),
})

// `openSessions` and `pausedRollouts` are null for a role the API keeps them from (FIRST-RELEASE.md §2); nav.ts
// shows those badges to no such role, so the count it never sees is zero.
export const loadNavBadges = async (): Promise<NavBadges> => {
  const { navBadges } = await query(`{ navBadges { partnersAwaitingApproval provisioningAttention openSessions pausedRollouts } }`, badgesSchema)
  return { ...navBadges, openSessions: navBadges.openSessions ?? 0, pausedRollouts: navBadges.pausedRollouts ?? 0 }
}
