import { impersonators } from './api/sessionRules'
import { staffRoles, type StaffRole } from './features/shell/staffRoles'

export type NavIconName = 'home' | 'users' | 'shop' | 'cart' | 'approve' | 'layers' | 'pulse' | 'staff' | 'mask'

export type NavBadgeSource = 'partnersAwaitingApproval' | 'provisioningAttention' | 'openSessions'

export interface NavRow {
  key: 'dashboard' | 'partners' | 'stores' | 'customers' | 'approvals' | 'provisioning' | 'impersonate' | 'activity' | 'staff'
  to: '/dashboard' | '/partners' | '/stores' | '/customers' | '/approvals' | '/provisioning' | '/impersonate' | '/activity' | '/staff'
  icon: NavIconName
  roles: readonly StaffRole[]
  // The roles the count is shown to on this row.
  badge?: { source: NavBadgeSource; roles: readonly StaffRole[] }
}

// A row as one role sees it: its badge, if it has one for that role.
export type NavItem = Omit<NavRow, 'badge'> & { badge?: NavBadgeSource }

const approvers: readonly StaffRole[] = ['staff-super-admin', 'staff-partner-manager']

// One badge per role, on the nearest menu that role can reach (decided on #43): partners
// awaiting approval count on Approvals for the two roles who approve, and on Partners for the
// rest, so nobody sees the number twice and nobody loses it.
export const navRows: readonly NavRow[] = [
  { key: 'dashboard', to: '/dashboard', icon: 'home', roles: staffRoles },
  {
    key: 'partners',
    to: '/partners',
    icon: 'users',
    roles: staffRoles,
    badge: { source: 'partnersAwaitingApproval', roles: staffRoles.filter((role) => !approvers.includes(role)) },
  },
  { key: 'stores', to: '/stores', icon: 'shop', roles: staffRoles },
  { key: 'customers', to: '/customers', icon: 'cart', roles: staffRoles },
  { key: 'approvals', to: '/approvals', icon: 'approve', roles: approvers, badge: { source: 'partnersAwaitingApproval', roles: approvers } },
  {
    key: 'provisioning',
    to: '/provisioning',
    icon: 'layers',
    roles: ['staff-super-admin', 'staff-support', 'staff-engineer'],
    badge: { source: 'provisioningAttention', roles: staffRoles },
  },
  { key: 'impersonate', to: '/impersonate', icon: 'mask', roles: impersonators, badge: { source: 'openSessions', roles: impersonators } },
  { key: 'activity', to: '/activity', icon: 'pulse', roles: staffRoles },
  { key: 'staff', to: '/staff', icon: 'staff', roles: ['staff-super-admin'] },
]

// A row a role can't use is left out, not disabled: absent means "not for you" (design.md §4).
export const navFor = (role: StaffRole, rows: readonly NavRow[] = navRows): readonly NavItem[] =>
  rows
    .filter((row) => row.roles.includes(role))
    .map(({ badge, ...row }) => (badge?.roles.includes(role) ? { ...row, badge: badge.source } : row))
