import type { ActivityEntry } from '#auth/activity'
import { selectMessage } from '#db/scoped/design'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectDraftCommits, selectPublishRun, selectVersionByNumber, type PublishRunView } from '#db/scoped/publishing'
import { publishBefore, startPublish, type GoBackActor } from '#saas/storefronts/index'
import type { DesignerDeps, DesignResult } from './service'
import { designAudit } from './words'

// Publishing from the studio (storefront AI-STUDIO §6; SAAS §9.1–§9.2): the store's StudioSession finishes any change and
// keeps the published theme privately, then the publish pipeline (INF 4, INF 5) builds it; going back moves the pointer.

export const createPublishingService = (deps: DesignerDeps) => {
  const { sql, context, actor, activity, facts, studio, now } = deps
  const { storeId } = context

  const entry = (action: string, changes: NonNullable<ActivityEntry['changes']>): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId: null,
    target: { type: 'storefront', id: storeId, label: 'storefront' },
    changes,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  /** The studio's hand-off: `commit` (the draft's head when null) with its theme kept privately for the push once live. */
  const handOff = async (commit: string | null): Promise<DesignResult<{ commit: string; template: string; coreVersion: string }>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const prepared = await studio.prepare(storeId, { commit })
    if (prepared.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: prepared.place }
    if (prepared.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (prepared.outcome === 'nothing') return { ok: false, reason: 'NOTHING_TO_PUBLISH' }
    return { ok: true, value: prepared }
  }

  const started = (tx: ScopedSql, runId: string, kind: string) => activity.record(tx, entry(designAudit.publishStarted, [{ field: 'publish', before: null, after: kind }])).then(() => runId)

  /** `publishDesign`: the draft's head through the full pipeline; nothing reaches the repo until it is live. */
  const publishDesign = async (): Promise<DesignResult<string>> => {
    const ready = await handOff(null)
    if (!ready.ok) return ready
    return withSystemScope(sql, async (tx) => {
      const run = await startPublish(tx, { storeId, kind: 'design', commit: ready.value.commit, template: ready.value.template, coreVersion: ready.value.coreVersion, usesAllowance: false, startedBy: { kind: 'user', id: actor.id }, at: now() })
      if (!run.ok) return { ok: false, reason: 'NOT_FOUND' }
      return { ok: true, value: await started(tx, run.runId, 'design') }
    })
  }

  /** "Publish everything before this change" (ARCHITECTURE §4.2 step 4): only for the change bisect named. */
  const publishEverythingBefore = async (messageId: string): Promise<DesignResult<string>> => {
    const message = await withScope(sql, context, (tx) => selectMessage(tx, storeId, messageId))
    if (!message?.commit) return { ok: false, reason: 'NOT_BISECTED' }
    const commits = await withSystemScope(sql, (tx) => selectDraftCommits(tx, storeId))
    const before = commits[commits.indexOf(message.commit) - 1]
    if (!before) return { ok: false, reason: 'NOT_BISECTED' }
    const ready = await handOff(before)
    if (!ready.ok) return ready
    return withSystemScope(sql, async (tx) => {
      const run = await publishBefore(tx, { storeId, commit: message.commit ?? '', by: actor.id, at: now() })
      if (!run.ok) return { ok: false, reason: 'NOT_BISECTED' }
      return { ok: true, value: await started(tx, run.runId, 'design') }
    })
  }

  /** `publishRun(id)`: the steps, the gate's and the post-deploy checks' plain words, and the change bisect named. */
  const publishRun = (id: string): Promise<PublishRunView | null> => withScope(sql, context, (tx) => selectPublishRun(tx, storeId, id))

  /**
   * "Go back to this" (SAAS §9.2; AI-STUDIO §5): the pointer moves to the version's kept build, using no build minutes,
   * and the draft is reset to it, all in the studio's turn so no change lands in between.
   */
  const goBackTo = async (number: number): Promise<DesignResult<true>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const version = await withScope(sql, context, (tx) => selectVersionByNumber(tx, storeId, number))
    if (!version) return { ok: false, reason: 'NOT_FOUND' }
    const by: GoBackActor = { actorKind: 'person', actorId: actor.id, actorLabel: null, api: 'store', ...facts }
    const result = await studio.goBack(storeId, { versionId: version.id, by: actor.id, actor: by })
    return result.ok ? { ok: true, value: true } : { ok: false, reason: result.reason }
  }

  return { publishDesign, publishEverythingBefore, publishRun, goBackTo }
}

