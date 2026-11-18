import { z } from 'zod'
import type { StoreRole } from '#auth/storePermissions'
import type { TenantContext } from '#core/tenancy'
import type { DesignRefusal, DesignResult } from './service'
import type { AskAnswer } from './studio'

// askDesign's and buildDesignPlan's runs on the DesignRun Workflow (storefront AI-STUDIO §4 "A design run"). Its params
// carry ids only: the request itself waits in the store's StudioSession until the run takes it.

export type DesignRunParams = { kind: 'ask' | 'build'; run: string; context: TenantContext; actor: { id: string; partnerId: string }; role: StoreRole }

export type DesignRunState = { state: 'running' } | { state: 'complete'; output: unknown } | { state: 'failed' } | { state: 'missing' }

/** The DesignRun binding, by instance id; index.ts wraps the Workflow, tests run the job in the same process. */
export interface DesignRuns {
  start: (id: string, params: DesignRunParams) => Promise<void>
  status: (id: string) => Promise<DesignRunState>
}

/** A Workflow instance id: unique per store, so another store's run is never found. */
export const designRunId = (storeId: string, run: string) => `${storeId}-${run}`

const facts = z.object({ requestId: z.string().nullable(), ip: z.string().nullable(), userAgent: z.string().nullable() })
const askInput = z.object({
  text: z.string(),
  model: z.string().nullable(),
  imageAssetId: z.string().nullable(),
  sampleUrl: z.string().nullable(),
  page: z.string(),
  device: z.enum(['desktop', 'tablet', 'phone']),
  mode: z.enum(['change', 'chat']),
})
const askRun = z.object({ kind: z.literal('ask'), input: askInput })
const buildRun = z.object({ kind: z.literal('build'), messageId: z.string(), model: z.string().nullable() })
export type RunRequest = z.infer<typeof askRun> | z.infer<typeof buildRun>
/** What the studio holds for a run: the request and its facts (LOGGING §4.1), never logged or put in params. */
export const heldRun = z.discriminatedUnion('kind', [askRun.extend({ facts }), buildRun.extend({ facts })])
export type HeldRun = z.infer<typeof heldRun>

/** The job's answer as plain JSON (a Workflow's output); messageId null when the run found nothing to take. */
export type DesignRunOutput = { ok: true; outcome: AskAnswer['outcome']; messageId: string | null } | ({ ok: false } & DesignRefusal)

export const runOutput = (result: DesignResult<AskAnswer>): DesignRunOutput =>
  result.ok ? { ok: true, outcome: result.value.outcome, messageId: result.value.message.id } : result

/** Only this job writes the output, so its shape is checked, not re-derived. */
export const outputOf = z.custom<DesignRunOutput>((v) => typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean')
