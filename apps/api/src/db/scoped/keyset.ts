import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// A newest-first keyset window on (time, id), as core/paging reads it; `before` alone reads backwards.

export const keysetWhere = (tx: ScopedSql, window: PageWindow, at: string, id: string) => tx`
  ${window.after ? tx`(${tx(at)}, ${tx(id)}) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
  and ${window.before ? tx`(${tx(at)}, ${tx(id)}) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}`

export const keysetOrder = (tx: ScopedSql, window: PageWindow, at: string, id: string) => {
  const dir = window.before && !window.after ? tx`asc` : tx`desc`
  return tx`order by ${tx(at)} ${dir}, ${tx(id)} ${dir} limit ${window.limit + 1}`
}
