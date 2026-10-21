import type { NewOutboxRow } from '#db/schema/outbox'
import { insertOutbox } from '#db/scoped/outbox'
import type { ScopedSql } from '#db/scoped/index'

export type SideEffect = NewOutboxRow

/**
 * Asks for a side effect in the transaction that decided it (api/README.md §5): nothing
 * leaves the Worker here. The relay delivers it after commit; a rolled-back transaction
 * leaves no row. Returns null when the idempotency key already queued it.
 */
export const queueSideEffect = (tx: ScopedSql, effect: SideEffect): Promise<string | null> => insertOutbox(tx, effect)

/** Thrown by a deliverer whose row can't go yet for a reason outside it: tried again later, never counted toward giving up. */
export class NotYet extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs: number,
  ) {
    super(`not yet: ${code}`)
    this.name = 'NotYet'
  }
}
