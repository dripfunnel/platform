import { z } from 'zod'
import type { CloudflareApi } from '#integrations/cloudflare/api'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ host: z.string().min(1) }).strict()

/** `domain.remove`: takes a removed portal host out of Cloudflare for SaaS, after the removal commits (SAAS.md §8). */
export const domainRemoveDeliverer = (cloudflare: CloudflareApi | null): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('domain.remove: bad payload')
    if (cloudflare) await cloudflare.removeHostname(parsed.data.host)
  },
})
