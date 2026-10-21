import { pgArray, type ScopedSql } from './index'

export type SuppressionReason = 'bounce' | 'complaint'

/**
 * The list's key (migrations/0034): HMAC-SHA-256 of the lower-cased address under
 * EMAIL_SUPPRESSION_KEY, so without the key the table can't confirm a guessed address.
 */
export const addressHash = async (key: string, address: string): Promise<string> => {
  const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0))
  const hmacKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(address.trim().toLowerCase()))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const hashes = async (key: string, addresses: readonly string[]) => new Map(await Promise.all(addresses.map(async (a) => [await addressHash(key, a), a] as const)))

/** Which of these addresses are on the list, in one query. */
export const suppressedAmong = async (tx: ScopedSql, key: string, addresses: readonly string[]): Promise<Set<string>> => {
  if (addresses.length === 0) return new Set()
  const byHash = await hashes(key, addresses)
  const rows = await tx<{ address_hash: string }[]>`select address_hash from email_suppression where address_hash = any(${pgArray([...byHash.keys()])}::text[])`
  return new Set(rows.map((r) => byHash.get(r.address_hash) ?? '').filter((a) => a !== ''))
}

/** Adds them in one statement. A complaint outranks a bounce: an address that complained stays recorded as one. */
export const suppressAll = async (tx: ScopedSql, key: string, addresses: readonly string[], reason: SuppressionReason, at: Date): Promise<void> => {
  // Once each: one statement can't upsert the same row twice.
  const unique = [...(await hashes(key, addresses)).keys()]
  if (unique.length === 0) return
  await tx`
    insert into email_suppression (address_hash, reason, suppressed_at)
    select hash, ${reason}, ${at} from unnest(${pgArray(unique)}::text[]) as hash
    on conflict (address_hash) do update set reason = case when email_suppression.reason = 'complaint' then 'complaint' else excluded.reason end
  `
}
