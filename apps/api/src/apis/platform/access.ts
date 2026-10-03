import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerConsoleService } from '#saas/partnerConsole/index'
import type { PartnerBrandingService } from '#saas/partnerBranding/index'
import type { PartnerPlansService } from '#saas/partnerPlans/index'
import type { PartnerStoresService } from '#saas/partnerStores/index'
import type { PartnerStoreActions } from '#saas/partnerStores/index'
import { isPartnerPermission, partnerPermissions, partnerRoleHas } from '#auth/partnerPermissions'
import { forbidden, unauthenticated, type AccessPolicy } from '../graphql/scope'

export interface PlatformContext extends Record<string, unknown> {
  /** Null when signed out. Its partner is the scope of every field (FIRST-RELEASE §16). */
  caller: PartnerCaller | null
  /** The caller's own partner's services; null when signed out. */
  console: PartnerConsoleService | null
  plans: PartnerPlansService | null
  branding: PartnerBrandingService | null
  stores: PartnerStoresService | null
  storeActions: PartnerStoreActions | null
}

/** ACCESS.md §5.3: the partner role's permission, always within the session's own partner. */
export const platformPolicy: AccessPolicy<PlatformContext> = {
  api: 'platform',
  scopes: ['public', 'session', 'partner'],
  permissions: partnerPermissions,
  authorize: async (access, { caller }) => {
    if (!caller) throw unauthenticated()
    if (access.permission === null) return
    if (!isPartnerPermission(access.permission) || !partnerRoleHas(caller.user.role, access.permission)) throw forbidden()
  },
}
