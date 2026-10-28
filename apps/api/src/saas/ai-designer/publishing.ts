import type { ActivityEntry } from '#auth/activity'
import { selectMessage } from '#db/scoped/design'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { lockStorefront, monthStart, pressesInFlight, selectCatalogueState, selectDraftCommits, selectLastPublish, selectPublishRun, selectVersionByNumber, type LastPublishRow, type PublishRunView } from '#db/scoped/publishing'
import { selectDesignUsage, selectRecentRuns, type RecentRequestRow } from '#db/scoped/design'
import { usedThisPeriod } from '#db/scoped/storeAccount'
import { UNLIMITED } from '#db/scoped/planKeys'
import { allowanceFor } from '#saas/entitlements/index'
import { autoPublishIntervalMs } from '#saas/storefronts/index'
import { publishBefore, startPublish, type GoBackActor } from '#saas/storefronts/index'
import { takeHandPush } from './handPush'
import type { DesignerDeps, DesignResult } from './service'
import { designAudit } from './words'

// Publishing from the studio (storefront AI-STUDIO §6; SAAS §9.1–§9.2): the store's StudioSession finishes any change and
// keeps the published theme privately, then the publish pipeline (INF 4, INF 5) builds it; going back moves the pointer.

export interface CatalogueView {
  waiting: boolean
  since: Date | null
  changedKinds: string[]
  changedProducts: number
  /** Null when the plan's presses are unlimited. */
  pressesAllowed: number | null
  pressesLeft: number | null
  nextAutomaticPublishAt: Date | null
}

export interface UsageView {
  /** On the merchant's own AI key: no plan meter for requests. */
  ownKey: boolean
  aiRequests: number
  aiTokens: number
  aiPromptsUsed: number
  aiPromptsAllowed: number | null
  buildMinutes: number
  publishesLast30Days: number
  recent: RecentRequestRow[]
}

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
    const taken = await takeHandPush(deps, entry)
    if (!taken.ok) return taken
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

  /** The Overview's rolled-back notice (FIRST-RELEASE §14): the newest finished publish of the design or the catalogue. */
  const lastPublish = (): Promise<LastPublishRow | null> => withScope(sql, context, (tx) => selectLastPublish(tx, storeId))

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

  /** The catalogue's "Publish now" bar (FIRST-RELEASE §14): what waits and since when, presses left, the next automatic publish. */
  const catalogue = async (): Promise<CatalogueView> => {
    const allowed = await allowanceFor(sql, context, 'publish_now', now())
    return withScope(sql, context, async (tx) => {
      const state = await selectCatalogueState(tx, storeId)
      const used = (await usedThisPeriod(tx, storeId, 'publish_now', monthStart(now()))) + (await pressesInFlight(tx, storeId))
      const since = state?.changes_since ?? null
      return {
        waiting: since !== null,
        since,
        changedKinds: state?.changed_kinds ?? [],
        changedProducts: state?.changed_count ?? 0,
        pressesAllowed: allowed >= UNLIMITED ? null : allowed,
        pressesLeft: allowed >= UNLIMITED ? null : Math.max(0, allowed - used),
        nextAutomaticPublishAt: since && state?.live_build_id ? (state.next_auto_publish_at ?? new Date(since.getTime() + autoPublishIntervalMs)) : null,
      }
    })
  }

  /**
   * "Publish now" (SAAS §9.1): the live code rebuilt with the catalogue as it is, using one of the month's presses; a
   * press queued or running holds one, and one that fails, is refused or rolls back is never counted (SAAS §6.2).
   */
  const publishNow = async (): Promise<DesignResult<string>> => {
    const allowed = await allowanceFor(sql, context, 'publish_now', now())
    return withSystemScope(sql, async (tx) => {
      if (!(await lockStorefront(tx, storeId))) return { ok: false, reason: 'NOT_FOUND' }
      const state = await selectCatalogueState(tx, storeId)
      if (!state?.live_commit || !state.live_template || !state.live_core_version) return { ok: false, reason: 'NOTHING_LIVE' }
      if (!state.changes_since) return { ok: false, reason: 'NOTHING_WAITING' }
      const used = (await usedThisPeriod(tx, storeId, 'publish_now', monthStart(now()))) + (await pressesInFlight(tx, storeId))
      if (used >= allowed) return { ok: false, reason: 'NO_PRESSES_LEFT' }
      const run = await startPublish(tx, { storeId, kind: 'manual', commit: state.live_commit, template: state.live_template, coreVersion: state.live_core_version, usesAllowance: true, startedBy: { kind: 'user', id: actor.id }, at: now() })
      if (!run.ok) return { ok: false, reason: 'NOT_FOUND' }
      return { ok: true, value: await started(tx, run.runId, 'manual') }
    })
  }

  /** "AI and build minutes" (FIRST-RELEASE §14): this month's meters, publishes in the last 30 days and the last 5 requests. */
  const usage = async (): Promise<UsageView> => {
    const own = (await allowanceFor(sql, context, 'ai_mode', now())) === 0
    const allowed = own ? null : await allowanceFor(sql, context, 'ai_prompts', now())
    return withScope(sql, context, async (tx) => {
      const u = await selectDesignUsage(tx, storeId, monthStart(now()), new Date(now().getTime() - 30 * 86_400_000))
      return {
        ownKey: own,
        aiRequests: u.ai_requests,
        aiTokens: u.ai_tokens,
        aiPromptsUsed: u.ai_prompts_used,
        aiPromptsAllowed: allowed === null || allowed >= UNLIMITED ? null : allowed,
        buildMinutes: u.build_minutes,
        publishesLast30Days: u.publishes,
        recent: await selectRecentRuns(tx, storeId, 5),
      }
    })
  }

  return { publishDesign, publishEverythingBefore, publishRun, lastPublish, goBackTo, publishNow, catalogue, usage }
}

