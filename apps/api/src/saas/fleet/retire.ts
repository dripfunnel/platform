import type postgres from 'postgres'
import type { ActivityEntry } from '#auth/activity'
import { logEvent } from '#core/log'
import { markImageDeleted, retireRelease, selectReleaseUse } from '#db/scoped/coreReleases'
import { hasRolloutActiveOrTo, insertRollout } from '#db/scoped/coreRollouts'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'

// The retirement of old core images (storefront AI-STUDIO §9, decided on #485): the account holds about 25 of them, so
// only the newest versions keep theirs for sure, and an older one goes once no store needs it.

/** The newest versions whose studio images always stay. */
export const keptImages = 20
/** About 50 GB at up to 2 GB an image (AI-STUDIO §7): past this, the engineer on call is alerted. */
export const imageBudget = 25

const job = (actorId: string, actorLabel: string) => ({ category: 'system', result: 'success', actorKind: 'job', actorId, actorLabel, partnerId: null, storeId: null, api: 'system', requestId: null, ip: null, userAgent: null, visibility: 'staff' }) as const

/** A version's studio image leaves (staff only, LOGGING §4): the job retires it, then the workflow deletes it. */
const releaseEntry = (version: string, action: string, field: string, after: string, by: ReturnType<typeof job>): ActivityEntry => ({
  ...by,
  action,
  target: { type: 'core_release', id: version, label: version },
  changes: [{ field, before: null, after }],
  reason: 'retire_images',
})

/** `retire-images.yml`'s record of an image it deleted from Cloudflare's registry, which can't be undone. */
export const recordImageDeleted = async (tx: ScopedSql, version: string, at: Date): Promise<void> => {
  await markImageDeleted(tx, version, at)
  await activityLog.record(tx, releaseEntry(version, 'core_release.image_deleted', 'image_deleted_at', at.toISOString(), job('retire-images', 'Core image deletion')))
}

/** `kept`: versions not retired; `held`: images still in the registry, a retired one counting until it is deleted. */
export type Retirement = { retired: string[]; rolloutId: string | null; kept: number; held: number }

/**
 * The daily job: an older version no store needs is retired (its image is deleted by `retire-images.yml`); while stores
 * a rollout can move still need one, a forced rollout to the newest version moves them first, once per version.
 */
export const retireCoreImages = (sql: postgres.Sql, now: Date): Promise<Retirement> =>
  withSystemScope(sql, async (tx) => {
    const releases = await selectReleaseUse(tx)
    const retired: string[] = []
    let movable = false
    for (const release of releases.slice(keptImages)) {
      if (release.retired_at) continue
      if (release.stores > 0) movable ||= release.movable > 0
      else {
        await retireRelease(tx, release.version, now)
        await activityLog.record(tx, releaseEntry(release.version, 'core_release.retired', 'retired_at', now.toISOString(), job('core-images', 'Core image retirement')))
        retired.push(release.version)
      }
    }
    const newest = releases[0]
    let rolloutId: string | null = null
    if (movable && newest && !(await hasRolloutActiveOrTo(tx, newest.version))) {
      rolloutId = await insertRollout(tx, { version: newest.version, security: false, by: null, reason: 'Retire old core images (AI-STUDIO §9)', at: now })
      await activityLog.record(tx, {
        category: 'system',
        action: 'core_rollout.started',
        result: 'success',
        actorKind: 'job',
        actorId: 'core-images',
        actorLabel: 'Core image retirement',
        partnerId: null,
        storeId: null,
        target: { type: 'core_rollout', id: rolloutId, label: newest.version },
        changes: [{ field: 'state', before: 'none', after: 'canary' }],
        reason: 'retire_images',
        api: 'system',
        requestId: null,
        ip: null,
        userAgent: null,
        visibility: 'staff',
      })
    }
    const kept = releases.filter((r) => !r.retired_at && !retired.includes(r.version)).length
    const held = releases.filter((r) => !r.image_deleted_at).length
    if (held > imageBudget) logEvent({ event: 'core_images_over_budget', api: 'system', code: 'over_budget', count: held })
    return { retired, rolloutId, kept, held }
  })
