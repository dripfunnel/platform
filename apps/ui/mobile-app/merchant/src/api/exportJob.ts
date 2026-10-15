import { z } from 'zod'

// An export is a job the API prepares and answers as CSV text (store FIRST-RELEASE §13). The app hands the text to the share sheet.

export type ExportState = 'preparing' | 'ready' | 'expired' | 'tooLarge' | 'failed'

export interface ExportJob {
  id: string
  state: ExportState
  entries: number | null
  csv: string | null
  expiresAt: string | null
  truncated: boolean
}

export const exportJobSchema = z.object({
  id: z.string(),
  state: z.enum(['queued', 'done', 'failed', 'too_large', 'expired']),
  rows: z.number().int().nullable(),
  truncated: z.boolean().nullable(),
  csv: z.string().nullable(),
  expiresAt: z.string().nullable(),
})

export const exportJobFields = 'id state rows truncated csv expiresAt'

const states = { queued: 'preparing', done: 'ready', failed: 'failed', too_large: 'tooLarge', expired: 'expired' } as const

/** A done job without its CSV has nothing to share, so it reads as failed. */
export const readExportJob = (job: z.infer<typeof exportJobSchema> | null): ExportJob | null => {
  if (!job) return null
  const state = states[job.state]
  const base = { id: job.id, entries: job.rows, expiresAt: job.expiresAt, truncated: job.truncated ?? false }
  if (state === 'ready' && job.csv === null) return { ...base, state: 'failed', csv: null }
  return { ...base, state, csv: state === 'ready' ? job.csv : null }
}
