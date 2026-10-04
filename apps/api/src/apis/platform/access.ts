import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerConsoleService } from '#saas/partnerConsole/index'
import type { PartnerDashboardService } from '#saas/partnerDashboard/index'
import type { PartnerDomainsService } from '#saas/partnerDomains/index'
import type { PartnerActivityService } from '#saas/partnerActivity/index'
import type { PartnerTeamService } from '#saas/partnerTeam/index'
import type { PartnerReportsService } from '#saas/partnerReports/index'
import type { PartnerSupportService } from '#saas/support/index'
import type { PartnerBillingService } from '#saas/billing/index'
import type { PartnerBrandingService } from '#saas/partnerBranding/index'
import type { PartnerPlansService } from '#saas/partnerPlans/index'
import type { PartnerStoresService } from '#saas/partnerStores/index'
import type { PartnerStoreActions } from '#saas/partnerStores/index'
import { isPartnerPermission, partnerPermissions, partnerRoleHas } from '#auth/partnerPermissions'
import { blockedIn, forbidden, unauthenticated, type AccessPolicy } from '../graphql/scope'

export interface PlatformContext extends Record<string, unknown> {
  /** Null when signed out. Its partner is the scope of every field (FIRST-RELEASE §16). */
  caller: PartnerCaller | null
  /** The caller's own partner's services; null when signed out. */
  console: PartnerConsoleService | null
  plans: PartnerPlansService | null
  branding: PartnerBrandingService | null
  stores: PartnerStoresService | null
  storeActions: PartnerStoreActions | null
  dashboard: PartnerDashboardService | null
  domains: PartnerDomainsService | null
  activity: PartnerActivityService | null
  team: PartnerTeamService | null
  reports: PartnerReportsService | null
  support: PartnerSupportService | null
  billing: PartnerBillingService | null
}

/** ACCESS.md §5.3: the partner role's permission, always within the session's own partner. */
export const platformPolicy: AccessPolicy<PlatformContext> = {
  api: 'platform',
  scopes: ['public', 'session', 'partner'],
  permissions: partnerPermissions,
  authorize: async (access, { caller }) => {
    if (!caller) throw unauthenticated()
    const session = caller.staff?.session.kind
    if (session && access.blockedFor?.includes(session)) throw blockedIn(session)
    if (access.permission === null) return
    if (!isPartnerPermission(access.permission) || !partnerRoleHas(caller.role, access.permission)) throw forbidden()
  },
}
