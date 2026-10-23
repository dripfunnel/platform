import { secureStorage as keystore } from '@dripfunnel/mobile-shared/storage'
import { z } from 'zod'
import type { Acting, SessionStorage } from './sessionStore'

// Only the ids and the name decide "last used"; the role and tier come fresh from the API at every start.
const actingSchema = z.object({ storeId: z.string(), supplierId: z.string().nullable(), storeName: z.string(), role: z.string().catch(''), tier: z.string().nullable().catch(null) })

export const parseLast = (saved: string | null): Acting | null => {
  try {
    const parsed = actingSchema.safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// Keyed by the portal host, so a build never reads another partner's session.
export const secureStorage = (domain: string): SessionStorage => keystore(domain, parseLast)
