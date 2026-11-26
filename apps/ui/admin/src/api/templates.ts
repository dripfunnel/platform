// The template catalogue on the Admin API (CONSOLE-DESIGN L4, FIRST-RELEASE §11d): every role reads it and opens a
// ready preview; a Super admin's first Preview sets up the template's demo store.
import { z } from 'zod'
import type { StaffRole } from '../features/shell/staffRoles'
import { query } from './client'

export const demoStates = ['none', 'creating', 'ready'] as const
export type DemoState = (typeof demoStates)[number]

// storeCategories.manage is Super admin's alone (ACCESS §5.4); the API is the check.
export const demoMakers: readonly StaffRole[] = ['staff-super-admin']

const templateSchema = z.object({
  key: z.string(),
  name: z.string(),
  tag: z.string(),
  description: z.string(),
  state: z.enum(['offered', 'retired']),
  categories: z.array(z.object({ id: z.string(), key: z.string(), names: z.array(z.object({ language: z.string(), name: z.string() })) })),
  storeCount: z.number().int().nonnegative(),
  demo: z.enum(demoStates),
})
export type StorefrontTemplate = z.infer<typeof templateSchema>

const fields = 'key name tag description state categories { id key names { language name } } storeCount demo'

export const loadTemplates = async (): Promise<StorefrontTemplate[]> =>
  (await query(`query StorefrontTemplates { storefrontTemplates { ${fields} } }`, z.object({ storefrontTemplates: z.array(templateSchema) }))).storefrontTemplates

const previewSchema = z.object({ demo: z.enum(demoStates), url: z.url().nullable() })
export type TemplatePreview = z.infer<typeof previewSchema>

/** The demo's open address once it is ready (storefront PREVIEW.md §9); `creating` (no address) while it is being set up. */
export const templatePreviewLink = async (key: string): Promise<TemplatePreview> =>
  (await query(`mutation TemplatePreviewLink($key: String!) { templatePreviewLink(key: $key) { demo url } }`, z.object({ templatePreviewLink: previewSchema }), { key })).templatePreviewLink

/** A collection's address: its tag (storefront ARCHITECTURE §2.3, the gallery's category), "Fashion & apparel" → "fashion-apparel". */
export const collectionKeyOf = (tag: string): string =>
  tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export interface TemplateCollection {
  key: string
  name: string
  templates: StorefrontTemplate[]
}

/** The templates grouped by tag, each collection where its first template comes in the API's gallery order. */
export const collectionsOf = (templates: readonly StorefrontTemplate[]): TemplateCollection[] => {
  const byKey = new Map<string, TemplateCollection>()
  for (const template of templates) {
    const key = collectionKeyOf(template.tag)
    const collection = byKey.get(key) ?? { key, name: template.tag, templates: [] }
    collection.templates.push(template)
    byKey.set(key, collection)
  }
  return [...byKey.values()]
}

// The codes the link refuses with (apps/api saas/storefrontTemplates), worded by the screen.
export const previewRefusals = ['NOT_FOUND', 'NO_DEMO', 'NO_SAMPLE', 'NO_HOUSE_PARTNER', 'PREVIEW_OFF', 'FORBIDDEN'] as const
