import type { ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'

// Every export the Platform API runs answers in one shape (§16): queued, done with its CSV, failed,
// too large, or expired an hour later. One reader for all of them, so a download link is made once
// per job and revoked when the job's link expires or the job stops being ready.
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

const links = new Map<string, string>()

const revoke = (id: string) => {
  const url = links.get(id)
  if (url) URL.revokeObjectURL(url)
  links.delete(id)
}

const linkFor = (id: string, csv: string, expiresAt: string | null): string => {
  const known = links.get(id)
  if (known) return known
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  links.set(id, url)
  if (expiresAt) setTimeout(() => revoke(id), Math.max(0, Date.parse(expiresAt) - Date.now()))
  return url
}

export const readExportJob = (job: z.infer<typeof exportJobSchema> | null): ExportJob | null => {
  if (!job) return null
  const state = states[job.state]
  const base = { id: job.id, entries: job.rows, expiresAt: job.expiresAt, truncated: job.truncated ?? false }
  // A done job without its CSV can't be downloaded, so it reads as failed rather than ready.
  if (state !== 'ready' || job.csv === null) {
    revoke(job.id)
    return { ...base, state: state === 'ready' ? 'failed' : state, url: null }
  }
  return { ...base, state, url: linkFor(job.id, job.csv, job.expiresAt) }
}
