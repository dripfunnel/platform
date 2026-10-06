import { z } from 'zod'
import type { CloudflareApi } from '#integrations/cloudflare/api'
import type { Deliverer } from '../outbox-relay'
import { withSystemScope } from '#db/scoped/index'
import { hostHeld } from '#db/scoped/partnerDomains'
import type postgres from 'postgres'

const payload = z.object({ host: z.string().min(1) }).strict()

/**
 * `domain.remove`: takes a removed portal host out of Cloudflare for SaaS, after the removal commits
 * (SAAS.md §8). Registered only when a client exists, so with no token the effect waits like `email`
 * does for SES. A host some partner has since claimed is left alone.
 */
export const domainRemoveDeliverer = (sql: postgres.Sql, cloudflare: CloudflareApi): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('domain.remove: bad payload')
    if (await withSystemScope(sql, (tx) => hostHeld(tx, parsed.data.host))) return
    await cloudflare.removeHostname(parsed.data.host)
  },
})
