import { logEvent } from '#core/log'
import { hasRolloutActiveOrTo, insertRollout, selectActiveRolloutVersion, selectReleaseForRollout } from '#db/scoped/coreRollouts'
import type { ScopedSql } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { job } from './retire'

// A promoted release starts its own rollout (SAAS §10): every store moves through the same canaries, waves and gate.

const releaseJob = job('core-release', 'Core release')

type ReleaseRollout = { started: string } | { skipped: 'rollout_active'; active: string } | { skipped: 'already_rolled_out' | 'not_recorded' }

/** Starts `version`'s rollout unless another one is running or paused (logged, for staff to start it later) or one ran already. */
export const startReleaseRollout = async (tx: ScopedSql, version: string, at: Date): Promise<ReleaseRollout> => {
  const release = await selectReleaseForRollout(tx, version)
  if (!release) return { skipped: 'not_recorded' }
  const active = await selectActiveRolloutVersion(tx)
  if (active !== null && active !== release.version) {
    logEvent({ event: 'core_rollout_not_started', api: 'system', code: 'rollout_active' })
    await activityLog.record(tx, {
      ...releaseJob,
      action: 'core_rollout.not_started',
      result: 'failed',
      target: { type: 'core_release', id: release.version, label: release.version },
      changes: [],
      reason: 'rollout_active',
    })
    return { skipped: 'rollout_active', active }
  }
  if (await hasRolloutActiveOrTo(tx, release.version)) return { skipped: 'already_rolled_out' }
  const id = await insertRollout(tx, { version: release.version, security: release.security, by: null, reason: 'Release promoted (SAAS §10)', at })
  await activityLog.record(tx, {
    ...releaseJob,
    action: 'core_rollout.started',
    target: { type: 'core_rollout', id, label: release.version },
    changes: [{ field: 'state', before: 'none', after: 'canary' }],
    reason: 'release',
  })
  return { started: id }
}
