import type { NavBadgeSource } from '../nav'

export type NavBadges = Record<NavBadgeSource, number>

const fixture: NavBadges = { partnersAwaitingApproval: 1 }

// Seam: no Admin API query returns these counts yet (FIRST-RELEASE.md §12 names none); the
// pull request lists them as fields the API needs.
export const loadNavBadges = (): Promise<NavBadges> => Promise.resolve(fixture)
