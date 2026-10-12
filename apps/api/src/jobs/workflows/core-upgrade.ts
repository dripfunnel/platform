import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { runStoreUpgrade, type UpgradeParams } from '#saas/fleet/index'
import { studioForJob } from '#saas/studio/index'
import type { StudioSessionObject } from '../durable/studio'

export interface CoreUpgradeEnv extends Record<string, unknown> {
  STOREFRONT_DRAFTS?: R2Bucket | undefined
  STUDIO_SESSION?: DurableObjectNamespace | undefined
}

// The sandbox's load, codemods and export take a container start and seconds of git (AI-STUDIO §9).
const stepConfig = { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '10 minutes' } as const

type Connect = (hyperdrive: { connectionString: string }) => postgres.Sql

/** One store's upgrade in a rollout (SAAS §10), started by the `storefront.upgrade` deliverer under the upgrade's id. */
export const coreUpgradeWorkflow = (connect: Connect) =>
  class CoreUpgrade extends WorkflowEntrypoint<CoreUpgradeEnv, UpgradeParams> {
    override async run(event: Readonly<WorkflowEvent<UpgradeParams>>, step: WorkflowStep): Promise<string> {
      const config = parseConfig(this.env)
      const drafts = this.env.STOREFRONT_DRAFTS
      const studios = this.env.STUDIO_SESSION as DurableObjectNamespace<StudioSessionObject> | undefined
      // The deliverer starts a run only where these exist, so this is a deploy that lost one since.
      if (!config.HYPERDRIVE || !drafts || !studios) throw new Error('core-upgrade: unconfigured')
      const sql = connect(config.HYPERDRIVE)
      try {
        const prepare = async (storeId: string, ask: Parameters<StudioSessionObject['prepareUpgrade']>[1]) => {
          const answer = await studioForJob(studios, storeId).prepareUpgrade(storeId, ask)
          return answer.outcome === 'busy' ? ('busy' as const) : { commit: answer.commit, notes: answer.notes }
        }
        return await runStoreUpgrade({ sql, drafts, prepare, now: () => new Date() }, event.payload, {
          do: (name, work) => step.do(name, stepConfig, work),
          sleep: (name, ms) => step.sleep(name, ms),
        })
      } finally {
        await sql.end()
      }
    }
  }
