// The five partner roles and their keys (docs/ui/platform/README.md §2, ACCESS.md §5.3).
export const partnerRoles = ['partner-owner', 'partner-admin', 'partner-support', 'partner-finance', 'partner-read-only'] as const

export type PartnerRole = (typeof partnerRoles)[number]
