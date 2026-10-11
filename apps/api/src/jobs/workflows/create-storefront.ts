import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { githubFor } from '#integrations/github/index'
import { runCreateStorefront, type CreateStorefrontParams } from '#saas/storefronts/index'

export interface CreateStorefrontEnv extends Record<string, unknown> {
  STOREFRONT_SITES?: R2Bucket | undefined
}

// A step's own retries, before the run gives up and undoes what it made (SAAS §5).
const stepConfig = { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' } as const

/** SAAS §5 steps 4–8, started by the `storefront.create` deliverer; index.ts, which alone opens connections, passes `connect`. */
export const createStorefrontWorkflow = (connect: (hyperdrive: { connectionString: string }) => postgres.Sql) =>
  class CreateStorefront extends WorkflowEntrypoint<CreateStorefrontEnv, CreateStorefrontParams> {
    override async run(event: Readonly<WorkflowEvent<CreateStorefrontParams>>, step: WorkflowStep): Promise<string> {
      const config = parseConfig(this.env)
      const github = await githubFor(config)
      const sites = this.env.STOREFRONT_SITES
      // The deliverer starts a run only where all three exist, so this is a deploy that lost one since.
      if (!config.HYPERDRIVE || !github || !sites) throw new Error('create-storefront: unconfigured')
      const sql = connect(config.HYPERDRIVE)
      try {
        return await runCreateStorefront({ sql, github, org: config.GITHUB_STORE_ORG, sites, now: () => new Date() }, event.payload, {
          do: (name, work) => step.do(name, stepConfig, work),
        })
      } finally {
        await sql.end()
      }
    }
  }
