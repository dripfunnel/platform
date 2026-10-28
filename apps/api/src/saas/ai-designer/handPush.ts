import type { ActivityEntry } from '#auth/activity'
import { failureCode, logEvent } from '#core/log'
import { adoptHandPush, handPushOf } from '#saas/storefronts/index'
import { recordAfter, type DesignerDeps, type DesignResult } from './service'
import { designAudit } from './words'

/** A hand push to `main` becomes one change to the draft (LIVE-SHOP §4 step 2): when the studio opens, and again at Publish. */
export const takeHandPush = async (deps: DesignerDeps, entry: (action: string, changes: NonNullable<ActivityEntry['changes']>) => ActivityEntry): Promise<DesignResult<null>> => {
  const { sql, studio, activity, actor } = deps
  const { storeId } = deps.context
  const repos = await deps.repos?.()
  if (!repos || !studio) return { ok: true, value: null }
  // GitHub being down never stops a publish: the draft is published as it is, and the push is taken next time.
  const push = await handPushOf(sql, repos, storeId).catch((error: unknown) => {
    logEvent({ event: 'storefront_hand_push_unread', api: 'store', storeId, code: failureCode(error) })
    return null
  })
  if (!push) return { ok: true, value: null }
  if (push.changes.length > 0) {
    const answer = await studio.importPush(storeId, { changes: push.changes, head: push.head, userId: actor.id })
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'refused') return { ok: false, reason: 'CHANGE_REFUSED', problems: answer.problems.length }
  }
  // A second Publish racing for the same push finds repo_head moved and records nothing; a failed write leaves the push to be taken again.
  await recordAfter(sql, storeId, async (tx) => {
    if (await adoptHandPush(tx, storeId, push)) await activity.record(tx, entry(designAudit.repoPushTaken, [{ field: 'main', before: push.from, after: push.head }]))
  })
  return { ok: true, value: null }
}
