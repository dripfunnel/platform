import type { TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { deleteDraft } from '#db/scoped/studio'
import type postgres from 'postgres'
import { StudioQueued, StudioUnavailable, studioAnswer, type StudioApi, type StudioRunner, type StudioState } from '#saas/studio/index'

// The StudioSession's RPC shape (jobs/durable/studio.ts) over StudioRunners in this process, one per store, named by the
// TenantContext's store as `studioOf` names the Durable Object. `calls` records which store each call reached.

export const localStudio = (sql: () => postgres.Sql, runnerOf: (storeId: string) => StudioRunner) => {
  const calls: { contextStore: string; storeId: string }[] = []
  const studio = (context: TenantContext): StudioApi => {
    const runner = (storeId: string) => {
      calls.push({ contextStore: context.storeId, storeId })
      if (storeId !== context.storeId) throw new Error('studio: a call for another store')
      return runnerOf(storeId)
    }
    return {
      status: async (storeId): Promise<StudioState> => {
        const r = runner(storeId)
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
        const r = runner(storeId)
        return studioAnswer(() => r.useTemplate(input.template, input.keep, input.userId))
      },
      change: async (storeId, input, model) => {
        const r = runner(storeId)
        return studioAnswer(() => r.change({ ...input, model }))
      },
      undo: async (storeId, input) => {
        const r = runner(storeId)
        return studioAnswer(() => r.undo(input.commit, input.userId))
      },
      texts: async (storeId, input) => runner(storeId).texts(input.page, input.locale),
      editText: async (storeId, input) => {
        const r = runner(storeId)
        return studioAnswer(() => r.editText(input.locale, input.key, input.text, input.userId))
      },
      discard: async (storeId) => runner(storeId).reset(() => withSystemScope(sql(), (tx) => deleteDraft(tx, storeId))),
    }
  }
  return { studio, calls }
}
