import type postgres from 'postgres'
import type { EdgeProbe, ProbeAnswer } from '#integrations/http/edgeProbe'
import { localEdgeProbe } from '#integrations/local/edgeProbe'
import { lookupLiveHost, type SitesBucket } from '#saas/storefronts/index'

// The post-deploy checks' edge in tests: the local stand-in over the fake buckets, with each answer open to change.

export interface TestProbe extends EdgeProbe {
  /** Answers every GET whose path matches with `answer` instead, as a broken page from the edge would. */
  breakPath: (path: RegExp, answer: Partial<ProbeAnswer>) => void
  gets: string[]
}

export const testProbe = (sql: postgres.Sql, buckets: { sites: SitesBucket; assets: SitesBucket }): TestProbe => {
  const local = localEdgeProbe({
    ...buckets,
    assetHost: 'sf-assets.dripfunnel.com',
    liveBuild: async (host) => {
      const found = await lookupLiveHost(sql, host, { localhost: false })
      return found.kind === 'store' && found.buildId ? { storeId: found.storeId, buildId: found.buildId } : null
    },
  })
  const broken: { path: RegExp; answer: Partial<ProbeAnswer> }[] = []
  const gets: string[] = []
  return {
    gets,
    breakPath: (path, answer) => {
      broken.push({ path, answer })
    },
    get: async (url) => {
      gets.push(url)
      const answer = await local.get(url)
      const fault = broken.find((b) => b.path.test(new URL(url).pathname))
      return fault && answer ? { ...answer, ...fault.answer } : answer
    },
    shop: local.shop,
  }
}
