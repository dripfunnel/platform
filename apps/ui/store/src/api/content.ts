import { z } from 'zod'
import { query } from './client'

// Storefront › Pages and Journal (StorefrontContent; FIRST-RELEASE §14, §19 "SAPI 24, built on #338";
// apps/api/src/apis/store/content.ts): `storefront.read` reads, `publish` (the Owner) writes.

export type ContentKind = 'page' | 'post'

export const contentStatuses = ['draft', 'scheduled', 'published'] as const
export type ContentStatus = (typeof contentStatuses)[number]

const text = z.string().nullable()
const rowSchema = z.object({ id: z.string(), title: z.string(), path: z.string(), status: z.enum(contentStatuses), inMenu: z.boolean(), publishAt: text, author: text, waitingForPublish: z.boolean(), updatedAt: z.string() })
export type ContentRow = z.infer<typeof rowSchema>
const rowFields = 'id title path status inMenu publishAt author waitingForPublish updatedAt'

const pageSchema = z.object({ nodes: z.array(rowSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text }) })

/** Fifty at a time, newest first: pages by when they were edited, posts by their date. */
export const loadContentList = async (kind: ContentKind, after: string | null): Promise<{ rows: ContentRow[]; next: string | null }> => {
  const field = kind === 'page' ? 'contentPages' : 'blogPosts'
  const page = (await query(`query L($after: String) { ${field}(first: 50, after: $after) { nodes { ${rowFields} } pageInfo { hasNextPage endCursor } } }`, z.object({ [field]: pageSchema.nullable() }), { after }))[field]
  return { rows: page?.nodes ?? [], next: page?.pageInfo.hasNextPage ? page.pageInfo.endCursor : null }
}

/** The pages the AI made (the theme's `routes.json`), which the Pages tab lists to open in the studio. */
export const loadCustomPaths = async (): Promise<string[]> => (await query('{ customPagePaths }', z.object({ customPagePaths: z.array(z.string()).nullable() }))).customPagePaths ?? []
