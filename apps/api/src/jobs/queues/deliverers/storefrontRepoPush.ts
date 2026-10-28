import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { GitHubRefused, type StoreRepos } from '#integrations/github/index'
import { NotYet } from '#saas/outbox/index'
import { handleRepoPush, repoPushParams } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// A busy store is tried again after about one build's length.
const busyRetryMs = 5 * 60 * 1000

/** `storefront.repo_push`: a push to a store repo's main becomes its publish (LIVE-SHOP §4); GitHub being down is retried. */
export const storefrontRepoPushDeliverer = (sql: postgres.Sql, repos: StoreRepos): Deliverer => ({
  deliver: async (effect) => {
    const parsed = repoPushParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const outcome = await handleRepoPush({ sql, repos, now: () => new Date() }, parsed.data).catch((error: unknown) => {
      // A commit or repo GitHub refuses to show (gone since, by a force push or a deletion) never builds.
      if (error instanceof GitHubRefused) throw new GiveUp('github_refused')
      throw error
    })
    logEvent({ event: 'repo_push', api: 'system', storeId: effect.storeId, code: outcome })
    if (outcome === 'busy') throw new NotYet('store_busy', busyRetryMs)
  },
})
