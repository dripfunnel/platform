import type { NewOutboxRow, OutboxRow } from '../schema/outbox'
import { pgArray, type ScopedSql } from './index'

/**
 * The new row's id, or null when the idempotency key has already queued this effect. The id
 * is chosen here rather than returned: a request may insert into the outbox but never read
 * it (migrations/0006), and RETURNING would need a read.
 */
export const insertOutbox = async (tx: ScopedSql, row: NewOutboxRow): Promise<string | null> => {
  const id = crypto.randomUUID()
  // Keys are per kind and per scope (DATA-MODEL.md §2: unique constraints are never global).
  const key = `${row.kind}:${row.partnerId ?? 'platform'}:${row.storeId ?? ''}:${row.idempotencyKey}`
  try {
    // A savepoint, not ON CONFLICT: the conflict check would need a read the role has not got.
    await tx.savepoint(
      (sp) => sp`
        insert into outbox (id, kind, idempotency_key, payload, partner_id, store_id)
        values (${id}, ${row.kind}, ${key}, ${JSON.stringify(row.payload)}::text::jsonb, ${row.partnerId}, ${row.storeId})
      `,
    )
    return id
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

/**
 * Many effects in one statement per chunk, as `insertOutbox` would queue them one by one. A key
 * already queued sends the chunk back through `insertOutbox`, which skips just that row.
 */
export const insertOutboxMany = async (tx: ScopedSql, rows: readonly NewOutboxRow[]): Promise<void> => {
  for (let i = 0; i < rows.length; i += outboxChunk) {
    const chunk = rows.slice(i, i + outboxChunk)
    const values = chunk.map((row) => ({
      id: crypto.randomUUID(),
      kind: row.kind,
      idempotency_key: `${row.kind}:${row.partnerId ?? 'platform'}:${row.storeId ?? ''}:${row.idempotencyKey}`,
      payload: JSON.stringify(row.payload),
      partner_id: row.partnerId,
      store_id: row.storeId,
    }))
    try {
      await tx.savepoint(
        (sp) => sp`
          insert into outbox (id, kind, idempotency_key, payload, partner_id, store_id)
          select id, kind, idempotency_key, payload::jsonb, partner_id, store_id
          from json_to_recordset(${JSON.stringify(values)}::text::json) as r(id uuid, kind text, idempotency_key text, payload text, partner_id uuid, store_id uuid)
        `,
      )
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      for (const row of chunk) await insertOutbox(tx, row)
    }
  }
}

const outboxChunk = 500

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'

/**
 * Takes a lease on due rows of the kinds that can be delivered; a kind nobody delivers yet is
 * left untouched. The attempt is counted here, so a relay that dies mid-delivery still moves
 * the row towards its limit. `skip locked` lets two sweeps run at once without sharing a row.
 */
export const claimDue = async (tx: ScopedSql, kinds: readonly string[], now: Date, limit: number, leaseMs: number): Promise<OutboxRow[]> => {
  const leaseExpired = new Date(now.getTime() - leaseMs)
  return tx<OutboxRow[]>`
    update outbox set attempts = attempts + 1, claimed_at = ${now}
    where id in (
      select id from outbox
      where delivered_at is null and failed_at is null
        and kind = any(${pgArray(kinds)}::text[])
        and next_attempt_at <= ${now}
        and (claimed_at is null or claimed_at < ${leaseExpired})
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning *
  `
}

/** True when this call delivered it; false when another already had. */
export const markDelivered = async (tx: ScopedSql, id: string, now: Date): Promise<boolean> => {
  const rows = await tx<{ id: string }[]>`
    update outbox set delivered_at = ${now}, claimed_at = null, last_error = null
    where id = ${id} and delivered_at is null
    returning id
  `
  return rows.length > 0
}

export const markAttemptFailed = async (
  tx: ScopedSql,
  id: string,
  outcome: { error: string; nextAttemptAt: Date; dead: boolean; now: Date },
): Promise<void> => {
  await tx`
    update outbox set
      last_error = ${outcome.error},
      next_attempt_at = ${outcome.nextAttemptAt},
      claimed_at = null,
      failed_at = ${outcome.dead ? outcome.now : null}
    where id = ${id} and delivered_at is null
  `
}
