// The partner console's permissions, one per screen need (ACCESS.md §5.3, decided on #109).
// Every one is scoped to the caller's own partner by the session, never by an argument.
export const partnerRoles = ['partner-owner', 'partner-admin', 'partner-support', 'partner-finance', 'partner-read-only'] as const

export type PartnerRole = (typeof partnerRoles)[number]

export const isPartnerRole = (role: string): role is PartnerRole => (partnerRoles as readonly string[]).includes(role)

export const partnerPermissions = [
  'partner.read',
  'onboarding.submit',
  'branding.write',
  'domains.write',
  'domains.recheck',
  'plans.write',
  'plans.price',
  'stores.create',
  'stores.plan',
  'stores.trial',
  'stores.suspend',
  'stores.invite.resend',
  'setup.retry',
  'stores.billingStatus',
  'billing.read',
  'billing.write',
  'payout.write',
  'card.write',
  'support.session',
  'exports',
  'activity.export',
  'team.manage',
  'team.transfer',
  'security.manage',
] as const

export type PartnerPermission = (typeof partnerPermissions)[number]

const everyone = ['partner.read', 'domains.recheck', 'exports'] as const

export const partnerRolePermissions: Record<PartnerRole, readonly PartnerPermission[]> = {
  'partner-owner': partnerPermissions,
  'partner-admin': [
    ...everyone,
    'onboarding.submit',
    'branding.write',
    'domains.write',
    'plans.write',
    'plans.price',
    'stores.create',
    'stores.plan',
    'stores.trial',
    'stores.suspend',
    'stores.invite.resend',
    'setup.retry',
    'stores.billingStatus',
    'billing.read',
    'support.session',
    'activity.export',
    'team.manage',
  ],
  'partner-support': [...everyone, 'support.session'],
  'partner-finance': [...everyone, 'plans.price', 'stores.trial', 'stores.billingStatus', 'billing.read', 'billing.write', 'payout.write', 'card.write'],
  'partner-read-only': [...everyone, 'billing.read'],
}

export const isPartnerPermission = (permission: string): permission is PartnerPermission =>
  (partnerPermissions as readonly string[]).includes(permission)

export const partnerRoleHas = (role: PartnerRole, permission: PartnerPermission): boolean =>
  partnerRolePermissions[role].includes(permission)
