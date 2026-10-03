import { z } from 'zod'
import type { StoreStatus } from '#db/schema/saas'
import type { StoreFilter } from '#db/scoped/stores'

// The Stores list's filter (ui/platform/FIRST-RELEASE.md §6.1), shared by the list and its export.

const day = 24 * 60 * 60 * 1000

export const storeFilter = z.strictObject({
  status: z.enum(['trial', 'active', 'pastdue', 'suspended', 'cancelled']).optional(),
  plan: z.guid().optional(),
  created: z.enum(['month', '30d', '90d']).optional(),
  storefront: z.enum(['live', 'building', 'failed', 'own']).optional(),
  near: z.literal('yes').optional(),
  q: z.string().trim().min(1).max(100).optional(),
})
export type StoreFilterInput = z.infer<typeof storeFilter>

const statusFor: Record<NonNullable<StoreFilterInput['status']>, StoreStatus | readonly StoreStatus[]> = {
  trial: 'trial',
  active: 'active',
  pastdue: 'past_due',
  suspended: 'suspended',
  cancelled: ['cancelled', 'closed'],
}

/** The list's filter as the database reads it; the accounts export reads the same (#221). */
export const toStoreFilter = (partnerId: string, f: StoreFilterInput, at: Date): StoreFilter => ({
  partnerId,
  status: f.status ? statusFor[f.status] : undefined,
  planId: f.plan,
  createdAfter: f.created === undefined ? undefined : f.created === 'month' ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)) : new Date(at.getTime() - (f.created === '30d' ? 30 : 90) * day),
  storefront: f.storefront,
  nearLimit: f.near === 'yes',
  q: f.q,
})
