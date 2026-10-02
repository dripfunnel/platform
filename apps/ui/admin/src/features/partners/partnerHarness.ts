import type { ActionPermission, Partner, PartnerAction, PartnerPage } from '../../api/partners'

export const partnersStates = ['loading', 'empty', 'error', 'readonly', 'denied'] as const
export type PartnersState = (typeof partnersStates)[number]

export const partnerStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type PartnerScreenState = (typeof partnerStates)[number]

// ?state=denied shows the API's page as a role without the permissions would get it: every
// action the record offers refused with the role code the API gives that action (ui/README.md §6).
const roleRefusal: Record<PartnerAction, ActionPermission> = {
  approve: { allowed: false, reason: 'PARTNER_ADMINS_ONLY' },
  sendBack: { allowed: false, reason: 'PARTNER_ADMINS_ONLY' },
  pause: { allowed: false, reason: 'SUPER_ADMIN_ONLY' },
  resume: { allowed: false, reason: 'SUPER_ADMIN_ONLY' },
  setupSession: { allowed: false, reason: 'PARTNER_ADMINS_ONLY' },
  sendInvite: { allowed: false, reason: 'INVITERS_ONLY' },
  resendInvite: { allowed: false, reason: 'INVITERS_ONLY' },
}

export const deniedPage = (page: PartnerPage): PartnerPage => ({ ...page, create: { allowed: false, reason: 'PARTNER_ADMINS_ONLY' } })

export const deniedPartner = (partner: Partner): Partner => ({
  ...partner,
  actions: Object.fromEntries(Object.keys(partner.actions).map((action) => [action, roleRefusal[action as PartnerAction]])),
  impersonate: Object.fromEntries(Object.keys(partner.impersonate).map((id) => [id, { allowed: false, reason: 'STAFF_ROLE_NOT_ALLOWED' as const }])),
})
