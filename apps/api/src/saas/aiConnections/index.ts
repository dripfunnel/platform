import type postgres from 'postgres'
import type { SecretBox } from '#auth/secretBox'
import { logEvent } from '#core/log'
import type { TenantContext } from '#core/tenancy'
import { clearCooldown, recordValidation, selectConnection, setCooldown, setPreferredModel, type ConnectionRef, type ConnectionRow, type ValidationStatus } from '#db/scoped/aiConnections'
import { withSystemScope } from '#db/scoped/index'
import { selectDefaultAiKey } from '#db/scoped/partnerCredentials'
import { GatewayError, type CredentialRefresher, type ResolvedConnection } from '#integrations/ai/index'
import type { AiOwner } from '#db/scoped/aiOauth'
import type { AiOAuth } from '#saas/aiOAuth/index'

// A store's AI connections as managed records (docs/api/SAAS.md §9.3): which are usable now, their health, cooldown and preferred
// model. State lives in the database, never in the Worker. Nothing here moves a request to a connection its tenant didn't authorize.
export const maxCooldownSeconds = 15 * 60
export const defaultCooldownSeconds = 60

export type ConnectionStatus = 'ok' | 'untested' | 'cooling_down' | 'needs_reconnect' | 'rejected' | 'unavailable'
export interface ConnectionHealth {
  connectionId: string
  provider: ConnectionRow['provider']
  authType: ConnectionRow['auth_type']
  status: ConnectionStatus
  cooldownUntil: Date | null
  lastValidatedAt: Date | null
  lastValidationStatus: ValidationStatus | null
  preferredModel: string | null
  fallbackAuthorized: boolean
}

/** `plan`: the partner's default key, with the store's own account only if its Owner authorized fallback. `own_key`: the store's account alone. */
export type ConnectionBilling = 'plan' | 'own_key'

export interface AiConnectionsDeps {
  sql: postgres.Sql
  context: TenantContext
  secrets: SecretBox | null
  oauth: AiOAuth | null
  now: () => Date
}

const storePrefix = 'store:'
const partnerPrefix = 'partner:'
const idShape = /^[0-9a-f-]{36}$/

export const createAiConnections = ({ sql, context, secrets, oauth, now }: AiConnectionsDeps) => {
  const { storeId, partnerId } = context

  /** A connection id names a row of this tenant or nothing: another tenant's id parses to null. */
  const refOf = (connectionId: string): ConnectionRef | null => {
    if (connectionId.startsWith(storePrefix)) return connectionId.slice(storePrefix.length) === storeId ? { kind: 'store', storeId } : null
    const credentialId = connectionId.slice(partnerPrefix.length)
    return connectionId.startsWith(partnerPrefix) && idShape.test(credentialId) ? { kind: 'partner', partnerId, credentialId } : null
  }
  const idOf = (ref: ConnectionRef): string => (ref.kind === 'store' ? `${storePrefix}${ref.storeId}` : `${partnerPrefix}${ref.credentialId}`)
  const ownerOf = (ref: ConnectionRef): AiOwner => (ref.kind === 'store' ? { kind: 'store', id: storeId, partnerId } : { kind: 'partner', id: partnerId, partnerId })
  const read = (ref: ConnectionRef) => withSystemScope(sql, (tx) => selectConnection(tx, ref))

  const statusOf = (row: ConnectionRow): ConnectionStatus => {
    if (row.status === 'rejected') return row.auth_type === 'oauth' ? 'needs_reconnect' : 'rejected'
    if (row.cooldown_until && row.cooldown_until > now()) return 'cooling_down'
    if (row.last_validation_status === 'unavailable') return 'unavailable'
    return row.status
  }

  const health = async (connectionId: string): Promise<ConnectionHealth | null> => {
    const ref = refOf(connectionId)
    const row = ref && (await read(ref))
    if (!ref || !row) return null
    return { connectionId: idOf(ref), provider: row.provider, authType: row.auth_type, status: statusOf(row), cooldownUntil: row.cooldown_until, lastValidatedAt: row.last_validated_at, lastValidationStatus: row.last_validation_status, preferredModel: row.preferred_model, fallbackAuthorized: row.fallback_authorized }
  }

  /** The whole connection's cooldown, or the named model's own. */
  const isCoolingDown = async (connectionId: string, model?: string): Promise<boolean> => {
    const ref = refOf(connectionId)
    const row = ref && (await read(ref))
    if (!row) return false
    if (statusOf(row) === 'cooling_down') return true
    const until = model ? row.cooldown_models[model] : undefined
    return until !== undefined && new Date(until) > now()
  }

  const markValidated = async (connectionId: string, result: ValidationStatus): Promise<void> => {
    const ref = refOf(connectionId)
    if (ref) await withSystemScope(sql, (tx) => recordValidation(tx, ref, result, now()))
  }

  /** The provider's own Retry-After, bounded; an unreadable one waits the default. Returns when it ends. */
  const startCooldown = async (connectionId: string, retryAfterSeconds: number | null, model?: string): Promise<Date | null> => {
    const ref = refOf(connectionId)
    if (!ref) return null
    const seconds = retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.min(Math.ceil(retryAfterSeconds), maxCooldownSeconds) : defaultCooldownSeconds
    const until = new Date(now().getTime() + seconds * 1000)
    await withSystemScope(sql, (tx) => setCooldown(tx, ref, until, model))
    logEvent({ event: 'ai_connection_cooldown', api: 'system', partnerId, storeId, count: seconds })
    return until
  }

  const endCooldown = async (connectionId: string): Promise<void> => {
    const ref = refOf(connectionId)
    if (ref) await withSystemScope(sql, (tx) => clearCooldown(tx, ref))
  }

  const setPreferred = async (connectionId: string, model: string | null): Promise<void> => {
    const ref = refOf(connectionId)
    if (ref) await withSystemScope(sql, (tx) => setPreferredModel(tx, ref, model))
  }

  /** The connection with its secret opened, or null when it can't be used: missing, rejected, cooling down or not renewable. */
  const resolveOne = async (ref: ConnectionRef, allowSignIn: boolean): Promise<ResolvedConnection | null> => {
    const row = await read(ref)
    if (!row || !secrets || statusOf(row) === 'cooling_down' || row.status === 'rejected') return null
    // A sign-in is one person's subscription: the studio may use it, `/api/v1` never (THIRD-PARTY-ACCESS §2.6).
    if (row.auth_type === 'oauth' && !allowSignIn) return null
    const base = { connectionId: idOf(ref), provider: row.provider, authType: row.auth_type, ...(row.preferred_model ? { preferredModel: row.preferred_model } : {}) }
    if (row.auth_type === 'oauth') {
      const token = await oauth?.accessToken(ownerOf(ref), ref.kind === 'partner' ? ref.credentialId : null)
      return token?.ok ? { ...base, secret: token.token, ...(token.accountId ? { accountId: token.accountId } : {}) } : null
    }
    const key = await secrets.open(row.key_enc)
    return key ? { ...base, secret: key } : null
  }

  /** The usable connections in order: the primary, then only a fallback the store's Owner authorized. Never another tenant's. */
  const resolveConnections = async (billed: ConnectionBilling, allowSignIn = false): Promise<ResolvedConnection[]> => {
    const refs: ConnectionRef[] = []
    if (billed === 'own_key') refs.push({ kind: 'store', storeId })
    else {
      const def = await withSystemScope(sql, (tx) => selectDefaultAiKey(tx, partnerId))
      if (def) refs.push({ kind: 'partner', partnerId, credentialId: def.id })
      const own = await read({ kind: 'store', storeId })
      if (own?.fallback_authorized) refs.push({ kind: 'store', storeId })
    }
    const out: ResolvedConnection[] = []
    for (const ref of refs) {
      const one = await resolveOne(ref, allowSignIn)
      if (one) out.push(one)
    }
    return out
  }

  /** Renews through saas/aiOAuth, which locks the row and rotates the refresh token once however many isolates ask (SAAS.md §9.3). */
  const refresher: CredentialRefresher = async (connectionId) => {
    const ref = refOf(connectionId)
    if (!ref || !oauth) throw new GatewayError('INVALID_CREDENTIALS')
    const token = await oauth.accessToken(ownerOf(ref), ref.kind === 'partner' ? ref.credentialId : null)
    if (token.ok) return { secret: token.token }
    throw new GatewayError(token.reason === 'EXPIRED' || token.reason === 'NOT_FOUND' ? 'INVALID_CREDENTIALS' : 'PROVIDER_UNAVAILABLE')
  }

  return { resolveConnections, health, isCoolingDown, markValidated, startCooldown, endCooldown, setPreferred, refresher }
}

export type AiConnections = ReturnType<typeof createAiConnections>
