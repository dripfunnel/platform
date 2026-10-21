import type postgres from 'postgres'
import { z } from 'zod'
import { roleHas } from '#auth/permissions'
import { staffById } from '#auth/staff'
import { completeExportJob, failExportJob, markExportTooLarge, saveExportProgress, selectStaffExportJob } from '#db/scoped/exportJobs'
import { withScope } from '#db/scoped/index'
import { selectEntryNames } from '#db/scoped/staffActivity'
import { listActivity } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { entryOf, staffCsvHeader, staffCsvLine, staffExportCap, staffExportLifetimeMs } from '#saas/staffActivity/index'
import { defaultRelayOptions, type Deliverer } from '../outbox-relay'

const payload = z.object({ jobId: z.guid(), staffId: z.guid(), chunk: z.number().int().min(0).optional() }).strict()

export interface StaffExportOptions {
  cap?: number
  /** How long one delivery reads before it saves its place and queues the next chunk. */
  budgetMs?: number
}

/**
 * `export.staff_activity`: the filtered log as CSV, read through the same scoped path as the
 * screen, as the staff member who asked, a chunk per delivery. Past the cap it ends as too large.
 */
export const staffActivityExportDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date(), options: StaffExportOptions = {}): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('export.staff_activity: bad payload')
    const { jobId, staffId } = parsed.data
    const chunk = parsed.data.chunk ?? 0
    const cap = options.cap ?? staffExportCap
    const budgetMs = options.budgetMs ?? 5_000
    const context = { caller: { kind: 'staff' as const, staffId } }
    const at = now()
    const expiresAt = new Date(at.getTime() + staffExportLifetimeMs)
    const startedMs = Date.now()
    try {
      const job = await withScope(sql, context, (tx) => selectStaffExportJob(tx, jobId))
      if (job?.state !== 'queued' || job.requested_by_id !== staffId) return
      // Every chunk checks again: a requester deactivated or demoted since asking gets nothing more.
      const staff = await withScope(sql, context, (tx) => staffById(tx, staffId))
      if (!staff || !roleHas(staff.role, 'activity.export')) {
        await withScope(sql, context, (tx) => failExportJob(tx, jobId, at, expiresAt))
        return
      }
      const lines = [job.csv ?? staffCsvHeader]
      let rows = job.rows ?? 0
      let after = job.cursor
      for (;;) {
        const result = await listActivity(sql, context, job.filter, { after })
        if (!result.ok) throw new Error(`export.staff_activity: ${result.code}`)
        const page = result.page.items
        const names = await withScope(sql, context, (tx) =>
          selectEntryNames(tx, [...new Set(page.flatMap((r) => (r.partner_id ? [r.partner_id] : [])))], [...new Set(page.flatMap((r) => (r.store_id ? [r.store_id] : [])))]),
        )
        for (const row of page) lines.push(staffCsvLine(entryOf(row, names)))
        rows += page.length
        if (rows > cap) {
          await withScope(sql, context, (tx) => markExportTooLarge(tx, jobId, at, expiresAt))
          return
        }
        const next = result.page.pageInfo.endCursor
        if (!result.page.pageInfo.hasNextPage || !next) break
        after = next
        if (Date.now() - startedMs > budgetMs) {
          // Out of time for this delivery: keep the place and the file so far, and carry on in the next.
          await withScope(sql, context, async (tx) => {
            await saveExportProgress(tx, jobId, { rows, csv: lines.join('\n'), cursor: next })
            await queueSideEffect(tx, { kind: 'export.staff_activity', idempotencyKey: `${jobId}:${chunk + 1}`, payload: { jobId, staffId, chunk: chunk + 1 }, partnerId: null, storeId: null })
          })
          return
        }
      }
      await withScope(sql, context, (tx) => completeExportJob(tx, jobId, { rows, truncated: false, csv: lines.join('\n'), at, expiresAt }))
    } catch (error) {
      if (effect.attempt >= defaultRelayOptions.maxAttempts) await withScope(sql, context, (tx) => failExportJob(tx, jobId, now(), expiresAt))
      throw error
    }
  },
})
