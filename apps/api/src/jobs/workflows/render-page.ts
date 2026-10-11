import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type postgres from 'postgres'
import type { PublishParams } from '#saas/storefronts/index'
import { runPublishWorkflow, type PublishStorefrontEnv } from './publish-storefront'

// The single-page render (storefront LIVE-SHOP.md §7): a page run, started by the `storefront.render_page` deliverer. Its
// steps are a publish's, with the live build's other files copied into its new folder before the switch.

export const renderPageWorkflow = (connect: (hyperdrive: { connectionString: string }) => postgres.Sql) =>
  class RenderPage extends WorkflowEntrypoint<PublishStorefrontEnv, PublishParams> {
    override run(event: Readonly<WorkflowEvent<PublishParams>>, step: WorkflowStep): Promise<string> {
      return runPublishWorkflow(this.env, connect, event, step)
    }
  }
