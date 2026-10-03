import type { ScopedSql } from './index'

// Exports as jobs (migrations/0021; LOGGING §6): asked for, built after commit, read back by id.

export interface ExportJobRow {
  id: string
  partner_id: string
  kind: 'activity'
  filter: Record<string, unknown>
  state: 'queued' | 'done' | 'failed'
  rows: number | null
  truncated: boolean
  csv: string | null
  requested_by_id: string
  requested_by_label: string
  created_at: Date
  finished_at: Date | null
  expires_at: Date | null
}

export const insertExportJob = async (tx: ScopedSql, j: { partnerId: string; kind: 'activity'; filter: Record<string, unknown>; byId: string; byLabel: string }): Promise<string> => {
  const id = crypto.randomUUID()
  await tx`
    insert into export_job (id, partner_id, kind, filter, requested_by_id, requested_by_label)
    values (${id}, ${j.partnerId}, ${j.kind}, ${JSON.stringify(j.filter)}::text::jsonb, ${j.byId}, ${j.byLabel})
  `
  return id
}

export const selectExportJob = async (tx: ScopedSql, id: string): Promise<ExportJobRow | null> =>
  (await tx<ExportJobRow[]>`select * from export_job where id = ${id}`)[0] ?? null

export const completeExportJob = async (tx: ScopedSql, id: string, r: { rows: number; truncated: boolean; csv: string; at: Date; expiresAt: Date }): Promise<void> => {
  await tx`
    update export_job set state = 'done', rows = ${r.rows}, truncated = ${r.truncated}, csv = ${r.csv}, finished_at = ${r.at}, expires_at = ${r.expiresAt}
    where id = ${id} and state = 'queued'
  `
}

export const failExportJob = async (tx: ScopedSql, id: string, at: Date, expiresAt: Date): Promise<void> => {
  await tx`update export_job set state = 'failed', finished_at = ${at}, expires_at = ${expiresAt} where id = ${id} and state = 'queued'`
}

/** An export is kept for its hour, and one never finished for a day at most (LOGGING §6); the request stays in the log. */
export const deleteExpiredExports = async (tx: ScopedSql, now: Date): Promise<number> =>
  (await tx`delete from export_job where expires_at < ${now} or created_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} returning id`).length
