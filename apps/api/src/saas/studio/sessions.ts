import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { storeRoleHas, type StoreRole } from '#auth/storePermissions'
import { idleMs, rememberIdleMs } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { deleteStudioSession, deleteUserStudioSession, insertStudioSession, renewStudioSession, selectLiveStudioSession, type StudioHolder } from '#db/scoped/studio'

// The studio frame's session id (storefront AI-STUDIO §3 step 6, §8): 128 random bits in the frame's path, kept only as
// its SHA-256, bound to the store, the user and the portal, staff or support session, and live 5 minutes unless renewed.

/** AI-STUDIO §9: a frame lives 5 minutes; the studio renews it every 2, so one missed renewal never closes it. */
export const studioSessionMs = 5 * 60 * 1000
export const studioRenewEveryMs = 2 * 60 * 1000

export const studioSessionPattern = /^[A-Za-z0-9_-]{22}$/

export type StudioAccess = 'change' | 'view'

/** ACCESS §5.1 `publish`: the Owner changes the design, a Manager sees it read-only, nobody else opens the studio. */
export const studioAccess = (context: TenantContext, role: StoreRole): StudioAccess | null => {
  const { caller } = context
  if (!(caller.kind === 'person' || caller.kind === 'impersonation' || caller.kind === 'support') || context.sellerScope.kind !== 'all' || role.side !== 'merchant') return null
  // A support session changes only once the store allows it (ACCESS §8).
  if (storeRoleHas(role, 'publish')) return caller.kind === 'support' && caller.access !== 'write' ? 'view' : 'change'
  return role.role === 'manager' ? 'view' : null
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const hashStudioSession = async (id: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))

const newStudioSessionId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export type OpenedStudioSession = { id: string; access: StudioAccess; expiresAt: Date }

/** Who holds a frame: the seat's user, and the one session it lives with (migration 0390). */
const holderOf = ({ caller }: TenantContext, userId: string): StudioHolder | null => {
  if (caller.kind === 'person') return { userId, userSessionHash: caller.sessionId, impersonationId: null, supportSessionId: null }
  if (caller.kind === 'impersonation') return { userId, userSessionHash: null, impersonationId: caller.impersonationId, supportSessionId: null }
  if (caller.kind === 'support') return { userId, userSessionHash: null, impersonationId: null, supportSessionId: caller.supportSessionId }
  return null
}

/** Opens a frame session for the context's store; the store comes from the session's TenantContext, never the request. */
export const openStudioSession = async (sql: postgres.Sql, context: TenantContext, role: StoreRole, userId: string, now: Date): Promise<OpenedStudioSession | null> => {
  const access = studioAccess(context, role)
  const holder = holderOf(context, userId)
  if (!access || !holder) return null
  const id = newStudioSessionId()
  const expiresAt = new Date(now.getTime() + studioSessionMs)
  await withSystemScope(sql, async (tx) => insertStudioSession(tx, { idHash: await hashStudioSession(id), storeId: context.storeId, holder, canChange: access === 'change', at: now, expiresAt }))
  return { id, access, expiresAt }
}

/** The renewal re-checks the caller as the Store API resolved it on this request (PREVIEW §5 step 4); a lost seat gets none. */
export const renewStudio = async (sql: postgres.Sql, context: TenantContext, role: StoreRole, userId: string, id: string, now: Date): Promise<Date | null> => {
  const access = studioAccess(context, role)
  const holder = holderOf(context, userId)
  if (!studioSessionPattern.test(id) || !holder) return null
  const idHash = await hashStudioSession(id)
  if (!access) {
    await withSystemScope(sql, (tx) => deleteStudioSession(tx, context.storeId, idHash))
    return null
  }
  const expiresAt = new Date(now.getTime() + studioSessionMs)
  const renewed = await withSystemScope(sql, (tx) => renewStudioSession(tx, { idHash, storeId: context.storeId, holder, canChange: access === 'change', at: now, expiresAt }))
  return renewed ? expiresAt : null
}

/** A renewal from someone who no longer acts in the store (removed, or another store chosen): the session ends at once. */
export const endStudioSession = async (sql: postgres.Sql, userId: string, id: string): Promise<void> => {
  if (!studioSessionPattern.test(id)) return
  const idHash = await hashStudioSession(id)
  await withSystemScope(sql, (tx) => deleteUserStudioSession(tx, userId, idHash))
}

/** By the hash a frame's WebSocket is tagged with: the alarm closes it once this answers null. */
export const liveStudioSessionHash = async (sql: postgres.Sql, storeId: string, idHash: string, now: Date): Promise<{ userId: string; access: StudioAccess } | null> => {
  const row = await withSystemScope(sql, (tx) => selectLiveStudioSession(tx, storeId, idHash, now, { idleMs, rememberIdleMs }))
  return row ? { userId: row.user_id, access: row.can_change ? 'change' : 'view' } : null
}

/** Asked by the store's Durable Object on every frame request, before anything is read (AI-STUDIO §8 "Checked"). */
export const liveStudioSession = async (sql: postgres.Sql, storeId: string, id: string, now: Date): Promise<{ userId: string; access: StudioAccess } | null> =>
  studioSessionPattern.test(id) ? liveStudioSessionHash(sql, storeId, await hashStudioSession(id), now) : null
