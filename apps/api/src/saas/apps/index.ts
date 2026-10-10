import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isMachineScope, mintAppToken } from '#auth/apiKeys'
import type { SecretBox } from '#auth/secretBox'
import type { StaffMember } from '#auth/staff'
import type { StoreCaller } from '#auth/storeCaller'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import { insertApp, insertGrant, lockLiveGrant, revokeGrant, selectAppsForStaff, selectGrants, selectLiveApp, setAppStatus } from '#db/scoped/apps'
import { withScope, type ScopedSql } from '#db/scoped/index'
import type { DnsLookup } from '#integrations/dns/doh'
import { queueSideEffect } from '#saas/outbox/index'
import { staffEntry } from '#saas/staff/index'
import { checkEndpointUrl, newSigningSecret } from '#saas/webhooks/index'

// Private apps (PLATFORM-PROMPT §5.5, ACCESS §5.6, SetDev's Apps): staff register one; an Owner installs it with consent
// to its scopes, store-wide (decided on #337), and the grant's token goes once to the app's own address, never to a person.

export const appAudit = {
  registered: 'app.registered',
  statusChanged: 'app.status_changed',
  installed: 'app.installed',
  uninstalled: 'app.uninstalled',
} as const

export const appNoticeKind = 'app.notice'

export type AppRefusal = 'INVALID_INPUT' | 'INVALID_SCOPES' | 'BAD_URL' | 'PRIVATE_ADDRESS' | 'UNAVAILABLE' | 'NOT_FOUND' | 'SCOPES_CHANGED' | 'ALREADY_INSTALLED'
export type AppResult<T> = { ok: true; value: T } | { ok: false; reason: AppRefusal }

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

export interface StoreAppsDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  secrets: SecretBox | null
  now: () => Date
}

export const createStoreAppsService = ({ sql, caller, activity, facts, secrets, now }: StoreAppsDeps) => {
  const storeId = caller.store.id
  const inStore = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, caller.context, work)

  const entry = (action: string, grant: { id: string; app: string }, changes: ActivityEntry['changes'] = []): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    target: { type: 'app_grant', id: grant.id, label: grant.app },
    changes,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const notify = (tx: ScopedSql, grantId: string, payload: Record<string, unknown>, key: string) =>
    queueSideEffect(tx, { kind: appNoticeKind, idempotencyKey: key, payload: { grantId, ...payload }, partnerId: caller.context.partnerId, storeId })

  /** The consent screen's app: what it is and what it may do. */
  const installable = async (rawId: string) => {
    const id = rawId.toLowerCase()
    return isUuid(id) ? inStore((tx) => selectLiveApp(tx, id)) : null
  }

  const list = (window: PageWindow) => inStore((tx) => selectGrants(tx, storeId, window))

  /** `scopes` are the ones the Owner was shown; an app whose scopes changed since asks again. */
  const install = async (rawAppId: string, consented: readonly string[]): Promise<AppResult<string>> => {
    const appId = rawAppId.toLowerCase()
    if (!isUuid(appId)) return { ok: false, reason: 'NOT_FOUND' }
    if (!secrets) return { ok: false, reason: 'UNAVAILABLE' }
    const token = await mintAppToken()
    const sealed = await secrets.seal(token.secret)
    const id = crypto.randomUUID()
    const at = now()
    return inStore(async (tx): Promise<AppResult<string>> => {
      const app = await selectLiveApp(tx, appId)
      if (!app) return { ok: false, reason: 'NOT_FOUND' }
      if (!sameSet(app.scopes, consented)) return { ok: false, reason: 'SCOPES_CHANGED' }
      if (!(await insertGrant(tx, { id, storeId, appId, scopes: app.scopes, tokenHash: token.hash, by: caller.person.id, now: at }))) return { ok: false, reason: 'ALREADY_INSTALLED' }
      await notify(tx, id, { notice: 'installed', tokenSealed: sealed }, `installed:${id}`)
      await activity.record(tx, entry(appAudit.installed, { id, app: app.name }, [{ field: 'scopes', before: null, after: [...app.scopes].sort().join(', ') }]))
      return { ok: true, value: id }
    })
  }

  /** Its access ends now; the app hears so, and what it already copied stays with it (SetDev). */
  const uninstall = async (rawId: string): Promise<AppResult<true>> => {
    const id = rawId.toLowerCase()
    if (!isUuid(id)) return { ok: false, reason: 'NOT_FOUND' }
    return inStore(async (tx): Promise<AppResult<true>> => {
      const grant = await lockLiveGrant(tx, storeId, id)
      if (!grant) return { ok: false, reason: 'NOT_FOUND' }
      await revokeGrant(tx, id, caller.person.id, now())
      await notify(tx, id, { notice: 'uninstalled' }, `uninstalled:${id}`)
      await activity.record(tx, entry(appAudit.uninstalled, { id, app: grant.app_name }))
      return { ok: true, value: true }
    })
  }

  return { installable, list, install, uninstall }
}

export interface AppRegistryDeps {
  sql: postgres.Sql
  staff: StaffMember
  activity: ActivityLog
  facts: RequestFacts
  secrets: SecretBox | null
  lookup: DnsLookup | null
  now: () => Date
}

export interface NewApp {
  name: string
  developer: string
  siteUrl: string
  webhookUrl: string
  scopes: readonly string[]
}

/** The registry, the Admin API's (staff with `apps.manage`): an app's signing secret is in the answer to its registration only. */
export const createAppRegistryService = ({ sql, staff, activity, facts, secrets, lookup, now }: AppRegistryDeps) => {
  const asStaff = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, { caller: { kind: 'staff', staffId: staff.id } }, work)
  const entry = staffEntry(staff, facts)

  const list = (window: PageWindow) => asStaff((tx) => selectAppsForStaff(tx, window))

  const register = async (input: NewApp): Promise<AppResult<{ id: string; secret: string }>> => {
    const name = input.name.trim()
    const developer = input.developer.trim()
    if (name.length === 0 || name.length > 80 || developer.length === 0 || developer.length > 120) return { ok: false, reason: 'INVALID_INPUT' }
    const scopes = [...new Set(input.scopes)].sort()
    if (scopes.length === 0 || !scopes.every(isMachineScope)) return { ok: false, reason: 'INVALID_SCOPES' }
    const site = await checkEndpointUrl(input.siteUrl, lookup)
    if (!site.ok) return { ok: false, reason: site.reason }
    const hook = await checkEndpointUrl(input.webhookUrl, lookup)
    if (!hook.ok) return { ok: false, reason: hook.reason }
    if (!secrets) return { ok: false, reason: 'UNAVAILABLE' }
    const secret = newSigningSecret()
    const id = crypto.randomUUID()
    const sealed = await secrets.seal(secret)
    await asStaff(async (tx) => {
      await insertApp(tx, { id, name, developer, siteUrl: site.url, webhookUrl: hook.url, scopes, secretSealed: sealed, by: staff.id, now: now() })
      await activity.record(tx, entry({ action: appAudit.registered, reason: null, target: { type: 'app', id, label: name }, visibility: 'staff', changes: [{ field: 'scopes', before: null, after: scopes.join(', ') }] }))
    })
    return { ok: true, value: { id, secret } }
  }

  /** A suspended app's grants stop working at once, and work again when it's made live. */
  const setStatus = async (rawId: string, status: 'live' | 'suspended'): Promise<AppResult<true>> => {
    const id = rawId.toLowerCase()
    if (!isUuid(id)) return { ok: false, reason: 'NOT_FOUND' }
    return asStaff(async (tx): Promise<AppResult<true>> => {
      const changed = await setAppStatus(tx, id, status, now())
      if (!changed) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, entry({ action: appAudit.statusChanged, reason: null, target: { type: 'app', id, label: changed.name }, visibility: 'staff', changes: [{ field: 'status', before: changed.before, after: status }] }))
      return { ok: true, value: true }
    })
  }

  return { list, register, setStatus }
}
