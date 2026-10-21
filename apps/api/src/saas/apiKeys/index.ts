import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { mintApiKey, scopesAllowed } from '#auth/apiKeys'
import type { StoreCaller } from '#auth/storeCaller'
import { isSupplierTier } from '#auth/storePermissions'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import { countLiveApiKeys, insertApiKey, lockLiveApiKey, revokeApiKeyChain, selectApiKeys, supersedeApiKey } from '#db/scoped/apiKeys'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { lockSupplier } from '#db/scoped/suppliers'

// Settings › Developers' API keys (ACCESS.md §5.6, SetDev): the Owner's (`settings`). The secret is in the answer to
// a create or a rotation and nowhere else: never logged, never read back.

export const apiKeyAudit = {
  created: 'api_key.created',
  rotated: 'api_key.rotated',
  revoked: 'api_key.revoked',
} as const

/** SetDev's choices; null never expires. */
export const apiKeyLifetimes = [30, 90, 365] as const

/** Live keys a store may hold at once. */
export const maxApiKeys = 50

/** How long a rotated key's old secret keeps working (ACCESS.md §5.6). */
export const rotationGraceMs = 24 * 60 * 60 * 1000

const day = 24 * 60 * 60 * 1000

export type ApiKeyRefusal = 'INVALID_INPUT' | 'INVALID_SCOPES' | 'NOT_FOUND' | 'TOO_MANY_KEYS'
export type ApiKeyResult<T> = { ok: true; value: T } | { ok: false; reason: ApiKeyRefusal }

export interface IssuedKey {
  id: string
  secret: string
  prefix: string
}

export interface NewKeyInput {
  name: string
  scopes: readonly string[]
  supplierId: string | null
  expiresInDays: number | null
}

export interface ApiKeysDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createApiKeysService = ({ sql, caller, activity, facts, now }: ApiKeysDeps) => {
  const storeId = caller.store.id
  const inStore = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, caller.context, work)

  const entry = (action: string, key: { id: string; label: string }, changes: ActivityEntry['changes'] = []): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    target: { type: 'api_key', id: key.id, label: key.label },
    changes,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  /** The supplier a key is bound to, live, with the tier that caps it; null when it's gone or suspended. */
  const liveSupplier = async (tx: ScopedSql, supplierId: string) => {
    const supplier = await lockSupplier(tx, storeId, supplierId)
    return supplier && supplier.status === 'active' && isSupplierTier(supplier.access_level) ? { name: supplier.name, tier: supplier.access_level } : null
  }

  const list = (window: PageWindow) => inStore((tx) => selectApiKeys(tx, storeId, window, now()))

  const create = async (input: NewKeyInput): Promise<ApiKeyResult<IssuedKey>> => {
    const name = input.name.trim()
    const lifetime = input.expiresInDays
    if (name.length === 0 || name.length > 80 || (lifetime !== null && !(apiKeyLifetimes as readonly number[]).includes(lifetime))) return { ok: false, reason: 'INVALID_INPUT' }
    const scopes = [...new Set(input.scopes)].sort()
    if (scopes.length === 0) return { ok: false, reason: 'INVALID_SCOPES' }
    const supplierId = input.supplierId?.toLowerCase() ?? null
    if (supplierId !== null && !isUuid(supplierId)) return { ok: false, reason: 'NOT_FOUND' }
    const minted = await mintApiKey()
    const id = crypto.randomUUID()
    const at = now()
    return inStore(async (tx): Promise<ApiKeyResult<IssuedKey>> => {
      // A key bound to a supplier holds only what that supplier's tier does (ACCESS.md §5.6).
      const supplier = supplierId ? await liveSupplier(tx, supplierId) : null
      if (supplierId && !supplier) return { ok: false, reason: 'NOT_FOUND' }
      if (!scopesAllowed(scopes, supplier?.tier ?? null)) return { ok: false, reason: 'INVALID_SCOPES' }
      await serialise(tx, `api_keys:${storeId}`)
      if ((await countLiveApiKeys(tx, storeId, at)) >= maxApiKeys) return { ok: false, reason: 'TOO_MANY_KEYS' }
      const expiresAt = lifetime === null ? null : new Date(at.getTime() + lifetime * day)
      await insertApiKey(tx, { id, storeId, sellerId: supplierId, name, prefix: minted.prefix, hash: minted.hash, scopes, createdBy: caller.person.id, expiresAt, rotatedFromId: null, now: at })
      await activity.record(
        tx,
        entry(apiKeyAudit.created, { id, label: name }, [
          { field: 'scopes', before: null, after: scopes.join(', ') },
          { field: 'supplier', before: null, after: supplier?.name ?? null },
          { field: 'expires_at', before: null, after: expiresAt?.toISOString() ?? null },
        ]),
      )
      return { ok: true, value: { id, secret: minted.secret, prefix: minted.prefix } }
    })
  }

  /** A new secret for the same access; the old one works a day more, so the swap needs no downtime. */
  const rotate = async (rawId: string): Promise<ApiKeyResult<IssuedKey>> => {
    const keyId = rawId.toLowerCase()
    if (!isUuid(keyId)) return { ok: false, reason: 'NOT_FOUND' }
    const minted = await mintApiKey()
    const id = crypto.randomUUID()
    const at = now()
    return inStore(async (tx): Promise<ApiKeyResult<IssuedKey>> => {
      const old = await lockLiveApiKey(tx, storeId, keyId, at)
      if (!old) return { ok: false, reason: 'NOT_FOUND' }
      // A key whose supplier has gone stays revocable, never renewable.
      if (old.seller_id && !(await liveSupplier(tx, old.seller_id))) return { ok: false, reason: 'NOT_FOUND' }
      await supersedeApiKey(tx, old.id, new Date(at.getTime() + rotationGraceMs), at)
      await insertApiKey(tx, { id, storeId, sellerId: old.seller_id, name: old.name, prefix: minted.prefix, hash: minted.hash, scopes: old.scopes, createdBy: caller.person.id, expiresAt: old.expires_at, rotatedFromId: old.id, now: at })
      await activity.record(tx, entry(apiKeyAudit.rotated, { id, label: old.name }, [{ field: 'prefix', before: old.prefix, after: minted.prefix }]))
      return { ok: true, value: { id, secret: minted.secret, prefix: minted.prefix } }
    })
  }

  const revoke = async (rawId: string): Promise<ApiKeyResult<true>> => {
    const keyId = rawId.toLowerCase()
    if (!isUuid(keyId)) return { ok: false, reason: 'NOT_FOUND' }
    const at = now()
    return inStore(async (tx): Promise<ApiKeyResult<true>> => {
      const key = await lockLiveApiKey(tx, storeId, keyId, at)
      if (!key) return { ok: false, reason: 'NOT_FOUND' }
      await revokeApiKeyChain(tx, storeId, key.id, caller.person.id, at)
      await activity.record(tx, entry(apiKeyAudit.revoked, { id: key.id, label: key.name }))
      return { ok: true, value: true }
    })
  }

  return { list, create, rotate, revoke }
}
