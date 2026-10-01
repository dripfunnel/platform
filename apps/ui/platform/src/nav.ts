import { partnerRoles, type PartnerRole } from './features/shell/partnerRoles'

export type NavIconName = 'home' | 'shop' | 'layers' | 'brush' | 'globe' | 'chart' | 'card' | 'buoy' | 'pulse' | 'gear'

export type NavBadgeSource = 'storesAttention' | 'brandingSetupLeft' | 'domainsWaiting' | 'billingFailedPayments' | 'supportOpenSessions'

export type NavKey = 'dashboard' | 'stores' | 'plans' | 'branding' | 'domains' | 'reports' | 'billing' | 'support' | 'activity' | 'settings'

export interface NavRow {
  key: NavKey
  to: `/${NavKey}`
  icon: NavIconName
  roles: readonly PartnerRole[]
  badge?: NavBadgeSource
}

// The ten rows of FIRST-RELEASE.md §2.1 in the prototype's order: Billing is absent for Support,
// Support for Finance and Read-only; what a role can't do is disabled inside the screen.
export const navRows: readonly NavRow[] = [
  { key: 'dashboard', to: '/dashboard', icon: 'home', roles: partnerRoles },
  { key: 'stores', to: '/stores', icon: 'shop', roles: partnerRoles, badge: 'storesAttention' },
  { key: 'plans', to: '/plans', icon: 'layers', roles: partnerRoles },
  { key: 'branding', to: '/branding', icon: 'brush', roles: partnerRoles, badge: 'brandingSetupLeft' },
  { key: 'domains', to: '/domains', icon: 'globe', roles: partnerRoles, badge: 'domainsWaiting' },
  { key: 'reports', to: '/reports', icon: 'chart', roles: partnerRoles },
  { key: 'billing', to: '/billing', icon: 'card', roles: ['partner-owner', 'partner-admin', 'partner-finance', 'partner-read-only'], badge: 'billingFailedPayments' },
  { key: 'support', to: '/support', icon: 'buoy', roles: ['partner-owner', 'partner-admin', 'partner-support'], badge: 'supportOpenSessions' },
  { key: 'activity', to: '/activity', icon: 'pulse', roles: partnerRoles },
  { key: 'settings', to: '/settings', icon: 'gear', roles: partnerRoles },
]

// A row a role can't use is left out, not disabled: absent means "not for you" (design.md §4).
export const navFor = (role: PartnerRole): readonly NavRow[] => navRows.filter((row) => row.roles.includes(role))
