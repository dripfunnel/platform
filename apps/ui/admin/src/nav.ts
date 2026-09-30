import { staffRoles, type StaffRole } from './features/shell/staffRoles'

export type NavIconName = 'home' | 'users' | 'shop' | 'cart'

export type NavBadgeSource = 'partnersAwaitingApproval'

export interface NavRow {
  key: 'dashboard' | 'partners' | 'stores' | 'customers'
  to: '/dashboard' | '/partners' | '/stores' | '/customers'
  icon: NavIconName
  roles: readonly StaffRole[]
  badge?: NavBadgeSource
}

// The first-release menus built so far, in FIRST-RELEASE.md §2 order; the rest become rows
// with their cards.
export const navRows: readonly NavRow[] = [
  { key: 'dashboard', to: '/dashboard', icon: 'home', roles: staffRoles },
  { key: 'partners', to: '/partners', icon: 'users', roles: staffRoles, badge: 'partnersAwaitingApproval' },
  { key: 'stores', to: '/stores', icon: 'shop', roles: staffRoles },
  { key: 'customers', to: '/customers', icon: 'cart', roles: staffRoles },
]

// A row a role can't use is left out, not disabled: absent means "not for you" (design.md §4).
export const navFor = (role: StaffRole, rows: readonly NavRow[] = navRows): readonly NavRow[] =>
  rows.filter((row) => row.roles.includes(role))
