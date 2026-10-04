import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { createPartnerActivityService } from '#saas/partnerActivity/index'
import { createPartnerBrandingService } from '#saas/partnerBranding/index'
import { createPartnerConsoleService } from '#saas/partnerConsole/index'
import { createPartnerDashboardService } from '#saas/partnerDashboard/index'
import { createPartnerDomainsService } from '#saas/partnerDomains/index'
import { createPartnerPlansService } from '#saas/partnerPlans/index'
import { createPartnerReportsService } from '#saas/partnerReports/index'
import { createPartnerStoreActions, createPartnerStoresService } from '#saas/partnerStores/index'
import { createPartnerTeamService } from '#saas/partnerTeam/index'
import { createPartnerSupportService } from '#saas/support/index'
import type { PlatformContext } from './access'

export interface PlatformContextDeps {
  sql: postgres.Sql
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  now: () => Date
}

export const signedOutContext: PlatformContext = { caller: null, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, activity: null, team: null, reports: null, support: null }

/** Every Platform API service for the caller, whichever kind it is (#243). */
export const platformContextFor = (caller: PartnerCaller | null, { secrets, ...base }: PlatformContextDeps): PlatformContext => {
  if (!caller) return signedOutContext
  const deps = { ...base, caller }
  return {
    caller,
    console: createPartnerConsoleService(deps),
    plans: createPartnerPlansService(deps),
    branding: createPartnerBrandingService(deps),
    stores: createPartnerStoresService(deps),
    storeActions: createPartnerStoreActions(deps),
    dashboard: createPartnerDashboardService(deps),
    domains: createPartnerDomainsService(deps),
    activity: createPartnerActivityService(deps),
    team: createPartnerTeamService(deps),
    reports: createPartnerReportsService(deps),
    // A partner user's own; no staff session reaches it (apis/platform/support.ts).
    support: caller.user && !caller.staff ? createPartnerSupportService({ ...deps, user: caller.user, secrets }) : null,
  }
}
