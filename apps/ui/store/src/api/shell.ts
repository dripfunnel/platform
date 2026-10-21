import { identityChanged } from '@dripfunnel/shared/ui'
import { z } from 'zod'
import { rememberActing } from '../acting'
import { forgetDrafts } from '../drafts'
import { merchantRoles, supplierTiers, type NavBadgeSource, type Seat } from '../nav'
import { allPages } from './allPages'
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

/** Every store the person holds under this partner: the switcher and the chooser need the whole list. */
export const loadMyStores = (): Promise<StoreChoice[]> =>
  allPages(async (after) => {
    const { myStores }: z.infer<typeof choicesSchema> = await query(
      `query Mine($after: String) { myStores(first: 50, after: $after) { nodes { membershipId store { id name } role tier seller { id name } } pageInfo { hasNextPage endCursor } } }`,
      choicesSchema,
      { after },
    )
    return myStores
  })

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

const badgesSchema = z.object({ navBadges: z.object({ products: z.number().int().nullable(), toShip: z.number().int().nullable() }).nullable() })

/** The menu's counts (FIRST-RELEASE §3.1, §19): orders to ship and products to approve. */
export const loadNavBadges = async (): Promise<Record<NavBadgeSource, number>> => {
  const { navBadges } = await query('{ navBadges { products toShip } }', badgesSchema)
  return { ordersToShip: navBadges?.toShip ?? 0, productsToApprove: navBadges?.products ?? 0 }
}

const switchSchema = z.object({ switchStore: choiceSchema })

/** Confirms the person holds the store (and supplier) and records the switch (ACCESS.md §4). */
export const switchStore = async (storeId: string, supplierId: string | null): Promise<StoreChoice> =>
  (await query(`mutation Switch($storeId: ID!, $supplierId: ID) { switchStore(storeId: $storeId, supplierId: $supplierId) { membershipId store { id name } role tier seller { id name } } }`, switchSchema, { storeId, supplierId })).switchStore

/** Opens a store: remembered only once the server confirms the person holds it, so a refusal leaves the old one. */
export const openStore = async (choice: Pick<StoreChoice, 'store' | 'seller'>): Promise<StoreChoice> => {
  const confirmed = await switchStore(choice.store.id, choice.seller?.id ?? null)
  rememberActing({ storeId: confirmed.store.id, supplierId: confirmed.seller?.id ?? null })
  return confirmed
}

/**
 * Ends the one session on this device, in every store (FIRST-RELEASE §3.2): the acting store is
 * forgotten first, then a plain form post the browser follows, so the page that comes next is the
 * server's answer and never one drawn while the cookie still works (as the partner console does).
 */
export const signOut = (): void => {
  rememberActing(null)
  forgetDrafts()
  identityChanged()
  const form = document.createElement('form')
  form.method = 'post'
  form.action = '/api/auth/sign-out'
  document.body.append(form)
  form.submit()
}
