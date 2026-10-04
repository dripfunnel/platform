import type postgres from 'postgres'
import { z } from 'zod'
import { completeExportJob, failExportJob, selectExportJob } from '#db/scoped/exportJobs'
import { withScope } from '#db/scoped/index'
import { computeReport, reportCsv, reportExportLifetimeMs, reportFilter, reportTabs } from '#saas/partnerReports/index'
import { defaultRelayOptions, type Deliverer } from '../outbox-relay'
import { exportPayload, exportScope } from './exportPayload'

const stored = reportFilter.extend({ tab: z.enum(reportTabs) })

/** `export.report`: a Reports tab's table as CSV, computed in the partner's own scope as the screen's. */
export const reportExportDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = exportPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('export.report: bad payload')
    const { jobId, partnerId } = parsed.data
    const scope = exportScope(parsed.data)
    try {
      await withScope(sql, scope, async (tx) => {
        const job = await selectExportJob(tx, jobId)
        if (job?.kind !== 'report' || job.state !== 'queued') return
        const { tab, ...filter } = stored.parse(job.filter)
        const at = now()
        const report = await computeReport(tx, tab, { partnerId, planId: filter.plan, country: filter.country }, filter, at)
        await completeExportJob(tx, jobId, { rows: report.rows.length, truncated: 'truncated' in report ? report.truncated : false, csv: reportCsv(report), at, expiresAt: new Date(at.getTime() + reportExportLifetimeMs) })
      })
    } catch (error) {
      if (effect.attempt >= defaultRelayOptions.maxAttempts) await withScope(sql, scope, (tx) => failExportJob(tx, jobId, now(), new Date(now().getTime() + reportExportLifetimeMs)))
      throw error
    }
  },
})
