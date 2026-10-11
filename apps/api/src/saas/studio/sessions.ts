import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { storeRoleHas, type StoreRole } from '#auth/storePermissions'
import { withSystemScope } from '#db/scoped/index'
import { deleteStudioSession, insertStudioSession, renewStudioSession, selectLiveStudioSession } from '#db/scoped/studio'

// The studio frame's session id (storefront AI-STUDIO §3 step 6, §8): 128 random bits in the frame's path, kept only as
// its SHA-256, bound to the store, the user and the portal session, and live 5 minutes unless renewed with a re-check.

/** AI-STUDIO §9: a frame lives 5 minutes; the studio renews it every 2, so one missed renewal never closes it. */
export const studioSessionMs = 5 * 60 * 1000
export const studioRenewEveryMs = 2 * 60 * 1000

export const studioSessionPattern = /^[A-Za-z0-9_-]{22}$/

export type StudioAccess = 'change' | 'view'

/** ACCESS §5.1 `publish`: the Owner changes the design, a Manager sees it read-only, nobody else opens the studio. */
export const studioAccess = (context: TenantContext, role: StoreRole): StudioAccess | null => {
  if (context.caller.kind !== 'person' || context.sellerScope.kind !== 'all' || role.side !== 'merchant') return null
  if (storeRoleHas(role, 'publish')) return 'change'
  return role.role === 'manager' ? 'view' : null
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const hashStudioSession = async (id: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))

const newStudioSessionId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export type OpenedStudioSession = { id: string; access: StudioAccess; expiresAt: Date }

/** Opens a frame session for the context's store; the store comes from the session's TenantContext, never the request. */
export const openStudioSession = async (sql: postgres.Sql, context: TenantContext, role: StoreRole, now: Date): Promise<OpenedStudioSession | null> => {
  const access = studioAccess(context, role)
  if (!access || context.caller.kind !== 'person') return null
  const caller = context.caller
  const id = newStudioSessionId()
  const expiresAt = new Date(now.getTime() + studioSessionMs)
  await withSystemScope(sql, async (tx) =>
    insertStudioSession(tx, { idHash: await hashStudioSession(id), storeId: context.storeId, userId: caller.userId, userSessionHash: caller.sessionId, canChange: access === 'change', at: now, expiresAt }),
  )
  return { id, access, expiresAt }
}

/** The renewal re-checks the caller as the Store API resolved it on this request (PREVIEW §5 step 4); a lost seat gets none. */
export const renewStudio = async (sql: postgres.Sql, context: TenantContext, role: StoreRole, id: string, now: Date): Promise<Date | null> => {
  const access = studioAccess(context, role)
  if (!studioSessionPattern.test(id) || context.caller.kind !== 'person') return null
  const caller = context.caller
  const idHash = await hashStudioSession(id)
  if (!access) {
    await withSystemScope(sql, (tx) => deleteStudioSession(tx, context.storeId, idHash))
    return null
  }
  const expiresAt = new Date(now.getTime() + studioSessionMs)
  const renewed = await withSystemScope(sql, (tx) =>
    renewStudioSession(tx, { idHash, storeId: context.storeId, userId: caller.userId, userSessionHash: caller.sessionId, canChange: access === 'change', at: now, expiresAt }),
  )
  return renewed ? expiresAt : null
}

/** Asked by the store's Durable Object on every frame request, before anything is read (AI-STUDIO §8 "Checked"). */
export const liveStudioSession = async (sql: postgres.Sql, storeId: string, id: string, now: Date): Promise<{ userId: string; access: StudioAccess } | null> => {
  if (!studioSessionPattern.test(id)) return null
  const row = await withSystemScope(sql, async (tx) => selectLiveStudioSession(tx, storeId, await hashStudioSession(id), now))
  return row ? { userId: row.user_id, access: row.can_change ? 'change' : 'view' } : null
}
