import { staffRoles, type StaffRole } from './features/shell/staffRoles'

export type NavIconName = 'home' | 'users' | 'shop'

export type NavBadgeSource = 'partnersAwaitingApproval'

export interface NavRow {
  key: 'dashboard' | 'partners' | 'stores'
  to: '/dashboard' | '/partners' | '/stores'
  icon: NavIconName
  roles: readonly StaffRole[]
  badge?: NavBadgeSource
}

// The first release ships these three (docs/ui/admin/FIRST-RELEASE.md §2); the (proposed)
// menus are not rows yet.
export const navRows: readonly NavRow[] = [
  { key: 'dashboard', to: '/dashboard', icon: 'home', roles: staffRoles },
  { key: 'partners', to: '/partners', icon: 'users', roles: staffRoles, badge: 'partnersAwaitingApproval' },
  { key: 'stores', to: '/stores', icon: 'shop', roles: staffRoles },
]

// A row a role can't use is left out, not disabled: absent means "not for you" (design.md §4).
export const navFor = (role: StaffRole): readonly NavRow[] =>
  navRows.filter((row) => row.roles.includes(role))
