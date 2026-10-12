import { StudioQueued, StudioUnavailable, type ChangeOutcome } from './runner'

// What the Store API asks of a store's StudioSession (storefront AI-STUDIO §2–§5), always named by the TenantContext's
// store (`studioOf`). The Durable Object implements it over RPC; tests drive a StudioRunner through the same shape.

/** A change's outcome, or why the sandbox couldn't take it; RPC keeps no error class, so both travel as values. */
export type StudioAnswer = ChangeOutcome | { outcome: 'queued'; place: number } | { outcome: 'unavailable' }

export const studioAnswer = async (work: () => Promise<ChangeOutcome>): Promise<StudioAnswer> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof StudioQueued) return { outcome: 'queued', place: error.place }
    if (error instanceof StudioUnavailable) return { outcome: 'unavailable' }
    throw error
  }
}

export interface StudioApi {
  useTemplate: (storeId: string, input: { template: string; keep: boolean; userId: string }) => Promise<StudioAnswer>
}
