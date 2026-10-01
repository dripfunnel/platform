import type { StaffRole } from './staff'

// One permission per FIRST-RELEASE screen need (ACCESS.md §5.4, decided on #14).
export const staffPermissions = [
  'partners.read',
  'stores.read',
  'customers.read',
  'activity.read',
  'customers.contact.read',
  'partners.create',
  'partners.approve',
  'partners.setup',
  'partners.invite',
  'partners.invite.resend',
  'partners.pause',
  'stores.suspend',
  'stores.restore',
  'stores.trial.extend',
  'stores.invite.resend',
  'stores.notes.write',
  'domains.recheck',
  'provisioning.read',
  'provisioning.retry',
  'provisioning.undo',
  'impersonate',
  'setupSessions.read',
  'staffSessions.endAny',
  'activity.export',
  'staff.manage',
] as const

export type StaffPermission = (typeof staffPermissions)[number]

const everyone = ['partners.read', 'stores.read', 'customers.read', 'activity.read'] as const

export const rolePermissions: Record<StaffRole, readonly StaffPermission[]> = {
  'staff-super-admin': staffPermissions,
  'staff-partner-manager': [
    ...everyone,
    'partners.create',
    'partners.approve',
    'partners.setup',
    'partners.invite',
    'partners.invite.resend',
    'stores.notes.write',
    'setupSessions.read',
  ],
  'staff-support': [
    ...everyone,
    'customers.contact.read',
    'partners.invite.resend',
    'stores.invite.resend',
    'stores.notes.write',
    'provisioning.read',
    'provisioning.retry',
    'impersonate',
    'setupSessions.read',
  ],
  // Billing is not in this release (FIRST-RELEASE §11 H), so Finance holds Read-only's set.
  'staff-finance': everyone,
  'staff-engineer': [
    ...everyone,
    'stores.suspend',
    'stores.notes.write',
    'domains.recheck',
    'provisioning.read',
    'provisioning.retry',
    'provisioning.undo',
    'activity.export',
  ],
  'staff-read-only': everyone,
}

/** Roles that act only on the partners assigned to them (ACCESS.md §5.4). */
export const partnerScopedRoles: readonly StaffRole[] = ['staff-partner-manager']

export const roleHas = (role: StaffRole, permission: StaffPermission): boolean =>
  rolePermissions[role].includes(permission)
