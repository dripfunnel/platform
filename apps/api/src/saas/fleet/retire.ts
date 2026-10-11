import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { retireRelease, selectReleaseUse } from '#db/scoped/coreReleases'
import { hasActiveRollout, insertRollout } from '#db/scoped/coreRollouts'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'

// The retirement of old core images (storefront AI-STUDIO §9, decided on #485): the account holds about 25 of them, so
// only the newest versions keep theirs for sure, and an older one goes once no store needs it.

/** The newest versions whose studio images always stay. */
export const keptImages = 20
/** About 50 GB at up to 2 GB an image (AI-STUDIO §7): past this, the engineer on call is alerted. */
export const imageBudget = 25

export type Retirement = { retired: string[]; rolloutId: string | null; kept: number }

/**
 * The daily job: an older version no store needs is retired (its image is deleted by `retire-images.yml`); while stores
 * still need one, a forced rollout to the newest version moves them first, one rollout at a time.
 */
export const retireCoreImages = (sql: postgres.Sql, now: Date): Promise<Retirement> =>
  withSystemScope(sql, async (tx) => {
    const releases = await selectReleaseUse(tx)
    const retired: string[] = []
    let needed = false
    for (const release of releases.slice(keptImages)) {
      if (release.retired_at) continue
      if (release.stores > 0) needed = true
      else {
        await retireRelease(tx, release.version, now)
        retired.push(release.version)
      }
    }
    const newest = releases[0]
    let rolloutId: string | null = null
    if (needed && newest && !(await hasActiveRollout(tx))) {
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
    if (kept > imageBudget) logEvent({ event: 'core_images_over_budget', api: 'system', code: 'over_budget', count: kept })
    return { retired, rolloutId, kept }
  })
