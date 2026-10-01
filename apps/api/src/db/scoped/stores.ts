import type { ScopedSql } from './index'

/** The partner a store belongs to, or null when the caller's scope doesn't see it. */
export const partnerOfStore = async (tx: ScopedSql, storeId: string): Promise<string | null> => {
  const rows = await tx<{ partner_id: string }[]>`select partner_id from store where id = ${storeId}`
  return rows[0]?.partner_id ?? null
}
