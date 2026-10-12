import { z } from 'zod'
import { query } from './client'

// Storefront › the brand step and Site settings (PortalStorefront, FIRST-RELEASE §14 and §19 "Built on #471";
// apps/api/src/apis/store/storefrontSettings.ts): `storefront.read` reads, `publish` (the Owner) writes.

/** The API's own length limits (saas/storefrontSettings/rules.ts), so a field never takes more than a save allows. */
export const brandLimits = { shopName: 80, tagline: 100, description: 300, voice: 60, email: 320, phone: 40, social: 300, street: 200, city: 100, postal: 20, region: 100 } as const
export const seoLimits = { title: 60, description: 155 } as const

export const socialNetworks = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'whatsapp'] as const
export type SocialNetwork = (typeof socialNetworks)[number]

const text = z.string().nullable()
const addressSchema = z.object({ street: text, city: text, postal: text, region: text })

const brandSchema = z.object({
  brandReady: z.boolean(),
  shopName: z.string(),
  logoAssetId: text,
  faviconAssetId: text,
  primaryColour: text,
  secondaryColour: text,
  tagline: text,
  description: text,
  social: z.object({ instagram: text, facebook: text, x: text, youtube: text, tiktok: text, whatsapp: text }),
  contactEmail: text,
  contactPhone: text,
  contactAddress: addressSchema.nullable(),
  voice: text,
})
export type StorefrontBrand = z.infer<typeof brandSchema>

const brandFields = 'brandReady shopName logoAssetId faviconAssetId primaryColour secondaryColour tagline description social { instagram facebook x youtube tiktok whatsapp } contactEmail contactPhone contactAddress { street city postal region } voice'

export const loadBrand = async (): Promise<StorefrontBrand | null> => (await query(`{ storefrontBrand { ${brandFields} } }`, z.object({ storefrontBrand: brandSchema.nullable() }))).storefrontBrand

export interface BrandInput {
  shopName: string
  logoAssetId: string
  faviconAssetId: string | null
  primaryColour: string | null
  secondaryColour: string | null
  tagline: string
  description: string
  social: Record<SocialNetwork, string>
  contactEmail: string
  contactPhone: string
  contactAddress: { street: string; city: string; postal: string; region: string }
  voice: string
}

/** The whole section at once: a field left empty is cleared (`brandReady` follows a name and a saved logo). */
export const saveBrand = async (input: BrandInput): Promise<StorefrontBrand> =>
  (await query(`mutation B($input: StorefrontBrandInput!) { saveStorefrontBrand(input: $input) { ${brandFields} } }`, z.object({ saveStorefrontBrand: brandSchema }), { input })).saveStorefrontBrand

const seoSchema = z.object({ title: text, description: text, shareImageAssetId: text })
export type StorefrontSeo = z.infer<typeof seoSchema>

export const loadSeo = async (): Promise<StorefrontSeo> => (await query('{ storefrontSeo { title description shareImageAssetId } }', z.object({ storefrontSeo: seoSchema }))).storefrontSeo

/** Saving renders the home page again at once, using no allowance (FIRST-RELEASE §14). */
export const saveSeo = async (input: { title: string; description: string; shareImageAssetId: string | null }): Promise<StorefrontSeo> =>
  (await query('mutation S($input: StorefrontSeoInput!) { saveStorefrontSeo(input: $input) { title description shareImageAssetId } }', z.object({ saveStorefrontSeo: seoSchema }), { input })).saveStorefrontSeo

export const domainStatuses = ['waiting', 'verifying', 'issuing', 'live', 'failed', 'expiring', 'broken'] as const
export type DomainStatus = (typeof domainStatuses)[number]

const domainSchema = z.object({
  /** Null for the free address. */
  id: z.string().nullable(),
  host: z.string(),
  kind: z.enum(['free', 'custom']),
  status: z.enum(domainStatuses),
  primary: z.boolean(),
  checkedAt: text,
  records: z.array(z.object({ type: z.string(), name: z.string(), value: z.string(), found: text })),
})
export type StorefrontDomain = z.infer<typeof domainSchema>

const domainsSchema = z.object({ customDomainAllowed: z.boolean(), domains: z.array(domainSchema) })
export type StorefrontDomains = z.infer<typeof domainsSchema>

const domainFields = 'id host kind status primary checkedAt records { type name value found }'

/** The free address first, then the store's own. */
export const loadDomains = async (): Promise<StorefrontDomains> =>
  (await query(`{ storefrontDomains { customDomainAllowed domains { ${domainFields} } } }`, z.object({ storefrontDomains: domainsSchema }))).storefrontDomains

export const connectDomain = async (host: string): Promise<StorefrontDomain> =>
  (await query(`mutation C($host: String!) { connectDomain(host: $host) { ${domainFields} } }`, z.object({ connectDomain: domainSchema }), { host })).connectDomain

/** Queues a check; storefrontDomains answers it once DNS does. */
export const checkDomain = async (id: string): Promise<void> => {
  await query('mutation K($id: ID!) { checkDomain(id: $id) }', z.object({ checkDomain: z.boolean() }), { id })
}

/** Null makes the free address the main one again. */
export const makeDomainPrimary = async (id: string | null): Promise<void> => {
  await query('mutation P($id: ID) { makeDomainPrimary(id: $id) }', z.object({ makeDomainPrimary: z.boolean() }), { id })
}

/** Also cancels a domain still waiting for DNS. */
export const removeDomain = async (id: string): Promise<void> => {
  await query('mutation R($id: ID!) { removeDomain(id: $id) }', z.object({ removeDomain: z.boolean() }), { id })
}

/** How many product photos the share image is picked from (PortalStorefront › Search and sharing). */
export const shareImageChoices = 5

/** The first photo of the most recently changed products that have one: the share image must be a product photo. */
export const loadShareImages = async (): Promise<string[]> => {
  const list = await query(
    'query L($first: Int!) { products(first: $first, sort: "updated") { nodes { id photoUrl } } }',
    z.object({ products: z.object({ nodes: z.array(z.object({ id: z.string(), photoUrl: z.string().nullable() })) }).nullable() }),
    { first: shareImageChoices },
  )
  const ids = (list.products?.nodes ?? []).filter((p) => p.photoUrl !== null).map((p) => p.id)
  if (ids.length === 0) return []
  const fields = ids.map((_, i) => `p${i}: product(id: $p${i}) { photos { assetId } }`).join(' ')
  const params = ids.map((_, i) => `$p${i}: ID!`).join(', ')
  const photos = await query(`query P(${params}) { ${fields} }`, z.record(z.string(), z.object({ photos: z.array(z.object({ assetId: z.string().nullable() })).nullable() }).nullable()), Object.fromEntries(ids.map((id, i) => [`p${i}`, id])))
  return ids.map((_, i) => photos[`p${i}`]?.photos?.[0]?.assetId ?? null).filter((id): id is string => id !== null)
}

// The design itself (FIRST-RELEASE §19 "Built on #318"; apps/api/src/apis/store/storefront.ts and studio.ts).
export const storefrontStatuses = ['not_started', 'creating', 'create_failed', 'not_published', 'same_as_live', 'unpublished_changes'] as const
export type StorefrontStatus = (typeof storefrontStatuses)[number]

const overviewSchema = z.object({
  status: z.enum(storefrontStatuses),
  template: text,
  live: z.object({ number: z.number().int(), publishedAt: z.string(), template: text }).nullable(),
  draft: z.object({ template: z.string(), changedAt: text, previewReady: z.boolean() }).nullable(),
})
export type StorefrontOverview = z.infer<typeof overviewSchema>

export const loadOverview = async (): Promise<StorefrontOverview> =>
  (await query('{ storefront { status template live { number publishedAt template } draft { template changedAt previewReady } } }', z.object({ storefront: overviewSchema }))).storefront

const templateSchema = z.object({ key: z.string(), name: z.string(), tag: z.string(), description: z.string(), demoUrl: text, current: z.boolean() })
export type StorefrontTemplate = z.infer<typeof templateSchema>

/** "Start from scratch" (`baseline`) first, then the six templates. */
export const loadTemplates = async (): Promise<StorefrontTemplate[]> =>
  (await query('{ storefrontTemplates { key name tag description demoUrl current } }', z.object({ storefrontTemplates: z.array(templateSchema) }))).storefrontTemplates

export const scratchTemplate = 'baseline'

/** The first choice starts making the store's site (`creating`); a later one changes the draft. Answers the new status. */
export const chooseTemplate = async (key: string, keepWords: boolean): Promise<StorefrontStatus> =>
  (await query('mutation T($key: String!, $keep: Boolean!) { chooseTemplate(key: $key, keepWords: $keep) }', z.object({ chooseTemplate: z.enum(storefrontStatuses) }), { key, keep: keepWords })).chooseTemplate

export const discardDraft = async (): Promise<void> => {
  await query('mutation { discardDraft }', z.object({ discardDraft: z.boolean() }))
}

/** Whether the plan keeps "Powered by" in the footer, and whether another plan removes it (the `billing` read, Owner only). */
export const loadPoweredBy = async (): Promise<{ removed: boolean; removable: boolean }> => {
  const plans = (await query('{ planCatalogue { current values { key enabled } } }', z.object({ planCatalogue: z.array(z.object({ current: z.boolean(), values: z.array(z.object({ key: z.string(), enabled: z.boolean().nullable() })) })).nullable() }))).planCatalogue ?? []
  const removes = (plan: (typeof plans)[number]) => plan.values.some((v) => v.key === 'powered_by_removal' && v.enabled === true)
  return { removed: plans.some((p) => p.current && removes(p)), removable: plans.some((p) => !p.current && removes(p)) }
}

const catalogueSchema = z.object({
  waiting: z.boolean(),
  since: text,
  changedKinds: z.array(z.string()),
  changedProducts: z.number().int(),
  pressesAllowed: z.number().int().nullable(),
  pressesLeft: z.number().int().nullable(),
  nextAutomaticPublishAt: text,
})
const usageSchema = z.object({
  ownKey: z.boolean(),
  aiRequests: z.number().int(),
  aiPromptsUsed: z.number().int(),
  aiPromptsAllowed: z.number().int().nullable(),
  buildMinutes: z.number().int(),
  publishesLast30Days: z.number().int(),
  recent: z.array(z.object({ id: z.string(), text: z.string(), createdAt: z.string() })),
})
const meterSchema = z.object({ catalogue: catalogueSchema, usage: usageSchema })
/** Catalogue changes waiting for a publish, and this month's AI and build use (FIRST-RELEASE §19 "Built on #318 (part 4)"). */
export type StorefrontMeters = z.infer<typeof meterSchema>

export const loadMeters = async (): Promise<StorefrontMeters> =>
  (
    await query(
      '{ storefront { catalogue { waiting since changedKinds changedProducts pressesAllowed pressesLeft nextAutomaticPublishAt } usage { ownKey aiRequests aiPromptsUsed aiPromptsAllowed buildMinutes publishesLast30Days recent { id text createdAt } } } }',
      z.object({ storefront: meterSchema }),
    )
  ).storefront

/** "Publish now": the live code rebuilt with the catalogue as it is, one of the month's presses; answers the publish's id. */
export const publishNow = async (): Promise<string> => (await query('mutation { publishNow }', z.object({ publishNow: z.string() }))).publishNow

const versionSchema = z.object({ id: z.string(), number: z.number().int(), template: z.string(), label: text, live: z.boolean(), publishedAt: z.string() })
export type StorefrontVersion = z.infer<typeof versionSchema>

/** The API's page of version history (apps/api saas/ai-designer `historyPage`); it answers no cursor, so a full page may have more. */
export const historyPageSize = 50

/** Version history, newest first, a page at a time before a version's number. */
export const loadHistory = async (before: number | null): Promise<StorefrontVersion[]> =>
  (await query('query H($before: Int) { storefront { history(before: $before) { id number template label live publishedAt } } }', z.object({ storefront: z.object({ history: z.array(versionSchema) }) }), { before })).storefront.history

/** "Go back to this": the version's kept build goes live again, using no build minutes, and the draft becomes it. */
export const goBackToVersion = async (number: number): Promise<void> => {
  await query('mutation G($n: Int!) { goBackToVersion(number: $n) }', z.object({ goBackToVersion: z.boolean() }), { n: number })
}

/** A signed link to the draft on the store's preview host (PREVIEW §5), recorded as opened. */
export const previewLink = async (): Promise<string> => (await query('mutation { previewLink }', z.object({ previewLink: z.string() }))).previewLink

/** Every preview link and its cookies stop at their next request (PREVIEW §5 step 4). */
export const endPreviewLinks = async (): Promise<void> => {
  await query('mutation { endPreviewLinks }', z.object({ endPreviewLinks: z.boolean() }))
}
