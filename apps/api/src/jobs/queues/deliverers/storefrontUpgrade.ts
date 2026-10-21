import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { pushUpgrade, upgradeParams, upgradePushParams, type UpgradeParams } from '#saas/fleet/index'
import type { StoreRepos } from '#integrations/github/index'
import type { SitesBucket } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

export type UpgradeWorkflow = Pick<Workflow<UpgradeParams>, 'get' | 'create'>

/** `storefront.upgrade`: starts the core-upgrade Workflow under the upgrade's id, so a redelivery finds the one it started. */
export const storefrontUpgradeDeliverer = (workflow: UpgradeWorkflow): Deliverer => ({
  deliver: async (effect) => {
    const parsed = upgradeParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const started = await workflow.get(parsed.data.upgradeId).then(
      () => true,
      () => false,
    )
    if (!started) await workflow.create({ id: parsed.data.upgradeId, params: parsed.data })
  },
})

/** `storefront.upgrade_push`: a live upgrade's files to the repo's main (LIVE-SHOP §8); GitHub being down is retried. */
export const storefrontUpgradePushDeliverer = (sql: postgres.Sql, repos: StoreRepos, drafts: SitesBucket): Deliverer => ({
  deliver: async (effect) => {
    const parsed = upgradePushParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const result = await pushUpgrade({ sql, repos, drafts, now: () => new Date() }, parsed.data)
    if (result.ok) return
    // Main somewhere else, or no repo yet, isn't fixed by trying again; the next publish's push catches main up.
    logEvent({ event: 'upgrade_push_refused', api: 'system', storeId: parsed.data.storeId, code: result.code })
    throw new GiveUp(result.code.toLowerCase())
  },
})
