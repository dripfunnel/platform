import { isStorePermission, merchantRolePermissions, supplierTierPermissions, type StorePermission, type SupplierTier } from './storePermissions'
import { hashSessionId } from './session'

// The store's API keys and app grant tokens (ACCESS.md §5.6): a secret shown once, kept as its SHA-256, named by a visible prefix.

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const apiKeyMark = 'dfk_'
export const appTokenMark = 'dfa_'
const secretLength = 48
const prefixLength = apiKeyMark.length + 8

// 248 is the largest multiple of 62 below 256, so every character is equally likely.
const randomText = (length: number): string => {
  let out = ''
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < 248 && out.length < length) out += alphabet[byte % 62]
    }
  }
  return out
}

export interface MintedApiKey {
  secret: string
  prefix: string
  hash: string
}

const mint = async (mark: string): Promise<MintedApiKey> => {
  const secret = mark + randomText(secretLength)
  return { secret, prefix: secret.slice(0, prefixLength), hash: await hashSessionId(secret) }
}

export const mintApiKey = (): Promise<MintedApiKey> => mint(apiKeyMark)
export const mintAppToken = (): Promise<MintedApiKey> => mint(appTokenMark)

const shapeOf = (mark: string) => new RegExp(`^${mark}[0-9A-Za-z]{${secretLength}}$`)
const keyShape = shapeOf(apiKeyMark)
const tokenShape = shapeOf(appTokenMark)

export type MachineCredential = { kind: 'api_key'; secret: string } | { kind: 'app_grant'; secret: string }

/** The API key or app token a request carries as its bearer token; null for a session token or none. */
export const machineCredentialOf = (request: Request): MachineCredential | null => {
  const bearer = /^Bearer ([^\s,;]+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (bearer === null) return null
  if (bearer.startsWith(apiKeyMark)) return { kind: 'api_key', secret: bearer }
  if (bearer.startsWith(appTokenMark)) return { kind: 'app_grant', secret: bearer }
  return null
}

export const isApiKeyShape = (value: string): boolean => keyShape.test(value)
export const isAppTokenShape = (value: string): boolean => tokenShape.test(value)

export const hashApiKey = (secret: string): Promise<string> => hashSessionId(secret)

/**
 * What a key or an app may be granted: the permissions of the Store API fields open to them (`machine` in
 * apis/graphql/scope.ts), never a capability. The structural test holds this list to those fields.
 */
export const machineScopes = ['catalog.read', 'stock.read', 'orders.read', 'customers.read'] as const satisfies readonly StorePermission[]
export type MachineScope = (typeof machineScopes)[number]

export const isMachineScope = (value: string): value is MachineScope => (machineScopes as readonly string[]).includes(value)

/** A key's scopes as granted, kept to the ones it could be given: a stored scope dropped from the list grants nothing. */
export const grantedScopes = (stored: readonly string[]): MachineScope[] => stored.filter(isMachineScope)

/**
 * What a key may do right now: its own scopes, and for a supplier-bound key only those its supplier's tier
 * still holds, so a narrowed tier narrows the key on the next request (ACCESS.md §5.6).
 */
export const effectiveScopes = (stored: readonly string[], tier: SupplierTier | null): ReadonlySet<StorePermission> => {
  const own = grantedScopes(stored)
  return new Set(tier === null ? own : own.filter((s) => supplierTierPermissions[tier].includes(s)))
}

/** The scopes an Owner may give a key: within the Owner's own role, and a supplier-bound key's within that supplier's tier. */
export const scopesAllowed = (wanted: readonly string[], tier: SupplierTier | null): wanted is MachineScope[] =>
  wanted.every((s) => isStorePermission(s) && isMachineScope(s) && merchantRolePermissions.owner.includes(s) && (tier === null || supplierTierPermissions[tier].includes(s)))
