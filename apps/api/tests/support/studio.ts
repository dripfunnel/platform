import type { TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { deleteDraft } from '#db/scoped/studio'
import type postgres from 'postgres'
import { goBack, type GoBackResult } from '#saas/storefronts/index'
import { preparedAnswer, StudioQueued, StudioUnavailable, studioAnswer, type KeptSummary, type LiveEvent, type StudioApi, type StudioRunner, type StudioState } from '#saas/studio/index'

// The StudioSession's RPC shape (jobs/durable/studio.ts) over StudioRunners in this process, one per store, named by the
// TenantContext's store as `studioOf` names the Durable Object. `calls` records which store each call reached, `live` each
// store's live events in the order its Durable Object would number them.

export const localStudio = (sql: () => postgres.Sql, runnerOf: (storeId: string) => StudioRunner) => {
  const calls: { contextStore: string; storeId: string }[] = []
  const kept = new Map<string, KeptSummary>()
  const live: { storeId: string; run: string; event: LiveEvent }[] = []
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
      activity: async (storeId) => {
        const r = runner(storeId)
        if (!r.loaded) await r.open().catch(() => undefined)
      },
      saved: async (storeId) => runner(storeId).saved(),
      useTemplate: async (storeId, input) => {
        const r = runner(storeId)
        return studioAnswer(() => r.useTemplate(input.template, input.keep, input.userId))
      },
      change: async (storeId, input, model) => {
        const r = runner(storeId)
        const { run, ...request } = input
        return studioAnswer(() => r.change({ ...request, model, progress: (event) => void live.push({ storeId, run, event }) }))
      },
      progress: async (storeId, run, event) => {
        runner(storeId)
        live.push({ storeId, run, event })
      },
      cancel: async (storeId) => runner(storeId).cancel(),
      undo: async (storeId, input) => {
        const r = runner(storeId)
        return studioAnswer(() => r.undo(input.commit, input.userId))
      },
      texts: async (storeId, input) => runner(storeId).texts(input.page, input.locale),
      editText: async (storeId, input) => {
        const r = runner(storeId)
        return studioAnswer(() => r.editText(input.locale, input.key, input.text, input.userId))
      },
      discard: async (storeId) => {
        await runner(storeId).reset(() => withSystemScope(sql(), (tx) => deleteDraft(tx, storeId)).then(() => true))
      },
      prepare: async (storeId, input) => {
        const r = runner(storeId)
        return preparedAnswer(() => r.prepare(input.commit))
      },
      goBack: async (storeId, input) => {
        let result: GoBackResult = { ok: false, reason: 'NOT_FOUND' }
        await runner(storeId).reset(async () => {
          result = await goBack(sql(), { storeId, versionId: input.versionId, by: input.by, actor: input.actor, now: new Date() })
          return result.ok
        })
        return result
      },
      summary: async (storeId) => {
        runner(storeId)
        return kept.get(storeId) ?? null
      },
      keepSummary: async (storeId, value) => {
        runner(storeId)
        kept.set(storeId, value)
      },
    }
  }
  return { studio, calls, live, kept }
}
