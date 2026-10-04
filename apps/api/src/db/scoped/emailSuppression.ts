import type { ScopedSql } from './index'

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

export const isSuppressed = async (tx: ScopedSql, key: string, address: string): Promise<boolean> => {
  const rows = await tx<{ one: number }[]>`select 1 as one from email_suppression where address_hash = ${await addressHash(key, address)}`
  return rows.length > 0
}

/** A complaint outranks a bounce: an address that complained stays recorded as one. */
export const suppress = async (tx: ScopedSql, key: string, address: string, reason: SuppressionReason, at: Date): Promise<void> => {
  await tx`
    insert into email_suppression (address_hash, reason, suppressed_at)
    values (${await addressHash(key, address)}, ${reason}, ${at})
    on conflict (address_hash) do update set reason = case when email_suppression.reason = 'complaint' then 'complaint' else excluded.reason end
  `
}
