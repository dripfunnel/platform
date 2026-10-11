import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type postgres from 'postgres'
import { parseConfig } from '#core/config'
import { githubFor, storeRepos } from '#integrations/github/index'
import { runPublish, type PublishParams } from '#saas/storefronts/index'

export interface PublishStorefrontEnv extends Record<string, unknown> {
  STOREFRONT_SITES?: R2Bucket | undefined
  STOREFRONT_ASSETS?: R2Bucket | undefined
  STOREFRONT_DRAFTS?: R2Bucket | undefined
}

// A step's own retries before the run fails and the live build stays (SAAS §9.1).
const stepConfig = { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' } as const

/** One run per publish, started by the `storefront.publish` deliverer; index.ts, which alone opens connections, passes `connect`. */
export const publishStorefrontWorkflow = (connect: (hyperdrive: { connectionString: string }) => postgres.Sql) =>
  class PublishStorefront extends WorkflowEntrypoint<PublishStorefrontEnv, PublishParams> {
    override async run(event: Readonly<WorkflowEvent<PublishParams>>, step: WorkflowStep): Promise<string> {
      const config = parseConfig(this.env)
      const { STOREFRONT_SITES: sites, STOREFRONT_ASSETS: assets, STOREFRONT_DRAFTS: drafts } = this.env
      const github = await githubFor(config)
      // The deliverer starts a run only where all of these exist, so this is a deploy that lost one since.
      if (!config.HYPERDRIVE || !sites || !assets || !drafts || !github) throw new Error('publish-storefront: unconfigured')
      const repos = storeRepos(github.session(), config.GITHUB_STORE_ORG)
      const api = `https://${config.HOOKS_HOST}`
      const sql = connect(config.HYPERDRIVE)
      try {
        const deps = {
          sql,
          sites,
          assets,
          drafts,
          // The asset host on the edge zone (LIVE-SHOP §2, decided on #317).
          assetOrigin: `https://sf-assets.${config.EDGE_ZONE}`,
          dispatch: (repo: string, buildId: string) => repos.dispatchBuild(repo, { build_id: buildId, api }),
          now: () => new Date(),
        }
        return await runPublish(deps, event.payload, {
          do: (name, work) => step.do(name, stepConfig, work),
          waitFor: async (name, type, timeoutMinutes) => {
            await step.waitForEvent(name, { type, timeout: `${timeoutMinutes} minutes` })
          },
        })
      } finally {
        await sql.end()
      }
    }
  }
