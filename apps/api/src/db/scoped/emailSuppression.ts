import type { ScopedSql } from './index'

export type SuppressionReason = 'bounce' | 'complaint'

/** The list's key (migrations/0034): a SHA-256 of the lower-cased address, never the address. */
export const addressHash = async (address: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address.trim().toLowerCase()))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const isSuppressed = async (tx: ScopedSql, address: string): Promise<boolean> => {
  const rows = await tx<{ one: number }[]>`select 1 as one from email_suppression where address_hash = ${await addressHash(address)}`
  return rows.length > 0
}

/** A complaint outranks a bounce: an address that complained stays recorded as one. */
export const suppress = async (tx: ScopedSql, address: string, reason: SuppressionReason, at: Date): Promise<void> => {
  await tx`
    insert into email_suppression (address_hash, reason, suppressed_at)
    values (${await addressHash(address)}, ${reason}, ${at})
    on conflict (address_hash) do update set reason = case when email_suppression.reason = 'complaint' then 'complaint' else excluded.reason end
  `
}
