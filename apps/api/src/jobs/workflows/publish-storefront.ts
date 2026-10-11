import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { runPublish, type PublishParams } from '#saas/storefronts/index'

export interface PublishStorefrontEnv extends Record<string, unknown> {
  STOREFRONT_SITES?: R2Bucket | undefined
  STOREFRONT_ASSETS?: R2Bucket | undefined
}

// A step's own retries before the run fails and the live build stays (SAAS §9.1).
const stepConfig = { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' } as const

/** One run per publish, started by the `storefront.publish` deliverer; index.ts, which alone opens connections, passes `connect`. */
export const publishStorefrontWorkflow = (connect: (hyperdrive: { connectionString: string }) => postgres.Sql) =>
  class PublishStorefront extends WorkflowEntrypoint<PublishStorefrontEnv, PublishParams> {
    override async run(event: Readonly<WorkflowEvent<PublishParams>>, step: WorkflowStep): Promise<string> {
      const config = parseConfig(this.env)
      const { STOREFRONT_SITES: sites, STOREFRONT_ASSETS: assets } = this.env
      // The deliverer starts a run only where all three exist, so this is a deploy that lost one since.
      if (!config.HYPERDRIVE || !sites || !assets) throw new Error('publish-storefront: unconfigured')
      const sql = connect(config.HYPERDRIVE)
      try {
        return await runPublish({ sql, sites, assets, now: () => new Date() }, event.payload, {
          do: (name, work) => step.do(name, stepConfig, work),
          waitForUpload: async (name, timeoutMinutes) => {
            await step.waitForEvent(name, { type: 'uploaded', timeout: `${timeoutMinutes} minutes` })
          },
        })
      } finally {
        await sql.end()
      }
    }
  }
