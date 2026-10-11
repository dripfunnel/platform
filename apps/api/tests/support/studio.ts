import type { TenantContext } from '#core/tenancy'
import { StudioQueued, StudioUnavailable, studioAnswer, type StudioApi, type StudioRunner, type StudioState } from '#saas/studio/index'

// The StudioSession's RPC shape (jobs/durable/studio.ts) over StudioRunners in this process, one per store, named by the
// TenantContext's store as `studioOf` names the Durable Object. `calls` records which store each call reached.

export const localStudio = (runnerOf: (storeId: string) => StudioRunner) => {
  const calls: { contextStore: string; storeId: string }[] = []
  const studio = (context: TenantContext): StudioApi => {
    const runner = () => runnerOf(context.storeId)
    const seen = (storeId: string) => {
      calls.push({ contextStore: context.storeId, storeId })
      if (storeId !== context.storeId) throw new Error('studio: a call for another store')
    }
    return {
      status: async (storeId): Promise<StudioState> => {
        seen(storeId)
        const r = runner()
        if (!r.loaded) {
          try {
            await r.open()
          } catch (error) {
            if (error instanceof StudioQueued) return { state: 'queued', place: error.place }
            if (error instanceof StudioUnavailable) return { state: 'unavailable' }
            throw error
          }
        }
        return r.pending > 0 ? { state: 'busy' } : { state: 'ready' }
      },
      useTemplate: async (storeId, input) => {
        seen(storeId)
        return studioAnswer(() => runner().useTemplate(input.template, input.keep, input.userId))
      },
    }
  }
  return { studio, calls }
}
