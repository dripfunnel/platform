import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// What the shell reads about the acting store and the person (FIRST-RELEASE.md §3, §19): the same queries the web
// portal's shell reads, none of them needed to sign in, so a failed one draws less rather than stopping the app.

export const meSchema = z.object({ name: z.string().nullable(), email: z.string() })
export type Person = z.infer<typeof meSchema>

export const loadPerson = async (client: ApiClient): Promise<Person> => (await typedQuery(client)('{ me { name email } }', z.object({ me: meSchema }))).me

const badgesSchema = z.object({ navBadges: z.object({ products: z.number().int().nullable(), toShip: z.number().int().nullable() }).nullable() })

/** Counts of work waiting, as the API says the caller may see them; nothing more carries a badge. */
export type Badges = { ordersToShip: number; productsToApprove: number }

export const loadBadges = async (client: ApiClient): Promise<Badges> => {
  const { navBadges } = await typedQuery(client)('{ navBadges { products toShip } }', badgesSchema)
  return { ordersToShip: navBadges?.toShip ?? 0, productsToApprove: navBadges?.products ?? 0 }
}

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

export const loadStoreState = async (client: ApiClient): Promise<StoreState | null> =>
  (await typedQuery(client)('{ storeState { readOnly status trialEndsAt pastDueSince provisioning { state step } support { partnerName agentFirstName endsAt } } }', stateSchema)).storeState

/** The person's saved choice of light or dark (My profile, `PortalProfile`); anything else is light. */
export const loadTheme = async (client: ApiClient): Promise<'light' | 'dark'> => {
  const { profile } = await typedQuery(client)('{ profile { theme } }', z.object({ profile: z.object({ theme: z.string().nullable() }) }))
  return profile.theme === 'dark' ? 'dark' : 'light'
}
