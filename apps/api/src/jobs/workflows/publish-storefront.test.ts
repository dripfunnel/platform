import { describe, expect, it } from 'vitest'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { PublishParams } from '#saas/storefronts/index'
import { runPublishWorkflow } from './publish-storefront'

const bucket = {} as R2Bucket
const env = {
  ADMIN_HOST: 'admin.localhost',
  PLATFORM_HOST: 'platform.localhost',
  HOOKS_HOST: 'hooks.localhost',
  HYPERDRIVE: { connectionString: 'postgres://u:p@localhost/db' },
  GITHUB_LOCAL: '1',
  STOREFRONT_SITES: bucket,
  STOREFRONT_ASSETS: bucket,
  STOREFRONT_DRAFTS: bucket,
}
const connect = () => {
  throw new Error('no connection should be opened')
}
const run = (extra: Record<string, unknown>) =>
  runPublishWorkflow({ ...env, ...extra }, connect as never, {} as WorkflowEvent<PublishParams>, {} as WorkflowStep)

describe('the publish workflow’s configuration guard', () => {
  it('refuses to start without SHOP_DOMAIN, so no sf-assets.undefined host is built', async () => {
    await expect(run({})).rejects.toThrow('publish-storefront: unconfigured')
  })

  it('gets past the guard with SHOP_DOMAIN set', async () => {
    await expect(run({ SHOP_DOMAIN: 'my-store.one' })).rejects.toThrow('no connection should be opened')
  })
})
