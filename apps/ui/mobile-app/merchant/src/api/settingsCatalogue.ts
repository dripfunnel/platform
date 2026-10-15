import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// Settings › Catalogue (CatSettings "catalogue"; FIRST-RELEASE (store) §15): which product page sections the store shows, and its badges.
// Default legal details, custom fields and the plan-usage meters wait for their API (§15), so they are not here.

export const sectionKeys = ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video'] as const
export type SectionKey = (typeof sectionKeys)[number]

export const badgeRules = ['new_30_days', 'top_5_this_month', 'below_compare_price', 'few_left', 'manual'] as const
export type BadgeRule = (typeof badgeRules)[number]

const settingsSchema = z.object({
  features: z.array(z.object({ key: z.string(), enabled: z.boolean(), inPlan: z.boolean().nullable() })),
  badges: z.array(z.object({ id: z.string(), label: z.string(), rule: z.string(), tone: z.string(), position: z.number().int() })),
})
export type CatalogueSettings = z.infer<typeof settingsSchema>
export type Badge = CatalogueSettings['badges'][number]

export const loadCatalogueSettings = async (client: ApiClient): Promise<CatalogueSettings> =>
  (
    await typedQuery(client)(
      '{ catalogueSettings { features { key enabled inPlan } badges { id label rule tone position } } }',
      z.object({ catalogueSettings: settingsSchema.nullable() }),
    )
  ).catalogueSettings ?? { features: [], badges: [] }

/** Which sections the store shows; one the plan lacks can't be switched on (`PLAN_LIMIT`). */
export const saveSections = async (client: ApiClient, features: { key: SectionKey; enabled: boolean }[]): Promise<void> => {
  await typedQuery(client)(
    'mutation SaveSections($f: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $f) { key } }',
    z.object({ saveCatalogueSettings: z.array(z.object({ key: z.string() })).nullable() }),
    { f: features },
  )
}

/** A new badge (no id), or a change to one; `position` keeps an edited one where it is. */
export const saveBadge = async (client: ApiClient, id: string | null, input: { label: string; rule: string; tone: string; position: number }): Promise<void> => {
  await typedQuery(client)('mutation SaveBadge($id: ID, $input: BadgeInput!) { saveBadge(id: $id, input: $input) }', z.object({ saveBadge: z.string().nullable() }), { id, input })
}

/** Off every product it was on, straight away. */
export const deleteBadge = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation DeleteBadge($id: ID!) { deleteBadge(id: $id) }', z.object({ deleteBadge: z.boolean().nullable() }), { id })
}
