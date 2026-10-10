import { isStorePermission, merchantRolePermissions, supplierTierPermissions, type StorePermission, type SupplierTier } from './storePermissions'
import { hashSessionId } from './session'

// The store's API keys (ACCESS.md §5.6): a secret shown once, kept as its SHA-256, named by a visible prefix.

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const apiKeyMark = 'dfk_'
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

export const mintApiKey = async (): Promise<MintedApiKey> => {
  const secret = apiKeyMark + randomText(secretLength)
  return { secret, prefix: secret.slice(0, prefixLength), hash: await hashSessionId(secret) }
}

const keyShape = new RegExp(`^${apiKeyMark}[0-9A-Za-z]{${secretLength}}$`)

/** The API key a request carries as its bearer token; null for a session token or none. */
export const apiKeyOf = (request: Request): string | null => {
  const bearer = /^Bearer ([^\s,;]+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  return bearer !== null && bearer.startsWith(apiKeyMark) ? bearer : null
}

export const isApiKeyShape = (value: string): boolean => keyShape.test(value)

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
