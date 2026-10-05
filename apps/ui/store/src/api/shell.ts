import { z } from 'zod'
import { merchantRoles, supplierTiers, type Seat } from '../nav'
import { query } from './client'

// The shell's reads (FIRST-RELEASE.md §3, §19; apps/api/schema/store.graphql): who is signed in and
// as what, their stores under this partner, and the acting store's state for the banners.

const named = z.object({ id: z.string(), name: z.string() })

const actingSchema = z.object({
  store: named,
  role: z.string(),
  tier: z.string().nullable(),
  seller: named.nullable(),
  plan: named.nullable(),
  permissions: z.array(z.string()),
})

const meSchema = z.object({ me: z.object({ id: z.string(), name: z.string(), email: z.string(), acting: actingSchema.nullable() }).nullable() })

export type Me = NonNullable<z.infer<typeof meSchema>['me']>
export type Acting = z.infer<typeof actingSchema>

/** The seat the menu follows; null for a role or tier this release doesn't know, which sees no menu. */
export const seatOf = (acting: Acting): Seat | null => {
  if (acting.seller) {
    const tier = supplierTiers.find((t) => t === acting.tier)
    if (!tier) return null
    return { side: 'supplier', tier, admin: acting.role === 'supplier-admin' }
  }
  const role = merchantRoles.find((r) => r === acting.role)
  return role ? { side: 'merchant', role } : null
}

export const loadMe = async (): Promise<Me | null> =>
  (await query(`{ me { id name email acting { store { id name } role tier seller { id name } plan { id name } permissions } } }`, meSchema)).me

const choiceSchema = z.object({ membershipId: z.string(), store: named, role: z.string(), tier: z.string().nullable(), seller: named.nullable() })
const choicesSchema = z.object({ myStores: z.object({ nodes: z.array(choiceSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }) })

export type StoreChoice = z.infer<typeof choiceSchema>

/** The person's stores under this partner; the switcher shows the first fifty, as the API pages. */
export const loadMyStores = async (): Promise<StoreChoice[]> =>
  (await query(`{ myStores(first: 50) { nodes { membershipId store { id name } role tier seller { id name } } pageInfo { hasNextPage endCursor } } }`, choicesSchema)).myStores.nodes

const stateSchema = z.object({
  storeState: z
    .object({
      readOnly: z.boolean(),
      status: z.string().nullable(),
      trialEndsAt: z.string().nullable(),
      pastDueSince: z.string().nullable(),
      provisioning: z.object({ state: z.string(), step: z.string() }).nullable(),
      support: z.object({ partnerName: z.string(), agentFirstName: z.string(), endsAt: z.string() }).nullable(),
    })
    .nullable(),
})

export type StoreState = NonNullable<z.infer<typeof stateSchema>['storeState']>

export const loadStoreState = async (): Promise<StoreState | null> =>
  (await query(`{ storeState { readOnly status trialEndsAt pastDueSince provisioning { state step } support { partnerName agentFirstName endsAt } } }`, stateSchema)).storeState

const switchSchema = z.object({ switchStore: choiceSchema })

/** Confirms the person holds the store (and supplier) and records the switch (ACCESS.md §4). */
export const switchStore = async (storeId: string, supplierId: string | null): Promise<StoreChoice> =>
  (await query(`mutation Switch($storeId: ID!, $supplierId: ID) { switchStore(storeId: $storeId, supplierId: $supplierId) { membershipId store { id name } role tier seller { id name } } }`, switchSchema, { storeId, supplierId })).switchStore

/** Ends the one session on this device, in every store (FIRST-RELEASE §3.2). */
export const signOut = async (): Promise<void> => {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // Signed out or not, the sign-in page follows; the session ends at its idle bound anyway.
  }
}
