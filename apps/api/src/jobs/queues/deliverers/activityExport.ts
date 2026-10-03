import type postgres from 'postgres'
import { z } from 'zod'
import { selectActivity } from '#db/scoped/activity'
import { completeExportJob, failExportJob, selectExportJob } from '#db/scoped/exportJobs'
import { maxPageSize as batch, withScope } from '#db/scoped/index'
import { activityFilter } from '#saas/activity/index'
import { activityCsvHeader, activityCsvLine, exportLifetimeMs, exportMaxRows } from '#saas/partnerActivity/index'
import { defaultRelayOptions, type Deliverer } from '../outbox-relay'

const payload = z.object({ jobId: z.guid(), partnerId: z.guid(), partnerUserId: z.guid() }).strict()

type PartnerScope = { caller: { kind: 'partner-user'; partnerUserId: string }; partnerId: string }

/** The partner's filtered log as CSV, read in its own scope so the log's policy decides what goes in. */
const build = (sql: postgres.Sql, scope: PartnerScope, jobId: string, now: () => Date) =>
  withScope(sql, scope, async (tx) => {
    const job = await selectExportJob(tx, jobId)
    if (!job || job.state !== 'queued') return
    const filter = activityFilter.parse(job.filter)
    const query = { ...filter, from: filter.from ? new Date(`${filter.from}T00:00:00.000Z`) : undefined, to: undefined }
    const lines: string[] = []
    let after: { occurredAt: Date; id: string } | undefined
    while (lines.length <= exportMaxRows) {
      const rows = await selectActivity(tx, query, { after }, batch)
      const page = rows.slice(0, batch)
      for (const row of page) lines.push(activityCsvLine(row))
      const last = page.at(-1)
      if (rows.length <= batch || !last) break
      after = { occurredAt: last.occurred_at, id: last.id }
    }
    const kept = lines.slice(0, exportMaxRows)
    const at = now()
    await completeExportJob(tx, jobId, { rows: kept.length, truncated: lines.length > exportMaxRows, csv: [activityCsvHeader, ...kept].join('\n'), at, expiresAt: new Date(at.getTime() + exportLifetimeMs) })
  })

/** `export.activity` (LOGGING §6): at most `exportMaxRows` entries; failed, not queued for ever, after the last attempt. */
export const activityExportDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('export.activity: bad payload')
    const { jobId, partnerId, partnerUserId } = parsed.data
    const scope: PartnerScope = { caller: { kind: 'partner-user', partnerUserId }, partnerId }
    try {
      await build(sql, scope, jobId, now)
    } catch (error) {
      if (effect.attempt >= defaultRelayOptions.maxAttempts) await withScope(sql, scope, (tx) => failExportJob(tx, jobId, now(), new Date(now().getTime() + exportLifetimeMs)))
      throw error
    }
  },
})
