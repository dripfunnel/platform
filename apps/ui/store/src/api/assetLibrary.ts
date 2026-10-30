import { z } from 'zod'
import { query } from './client'

// Storefront › Assets: the merchant's own images and videos (docs/storefront/AI-STUDIO.md §8). `storefront.read` looks,
// the Owner renames and deletes; a file is uploaded through `POST /api/assets` like every other.

const assetSchema = z.object({ id: z.string(), kind: z.enum(['image', 'video']), mime: z.string(), bytes: z.number().int(), width: z.number().int().nullable(), height: z.number().int().nullable(), name: z.string().nullable(), uses: z.number().int(), createdAt: z.string() })
export type LibraryAsset = z.infer<typeof assetSchema>

export const loadLibrary = async (o: { after: string | null; kind: 'image' | 'video' | null; search: string }): Promise<{ assets: LibraryAsset[]; next: string | null }> =>
  (
    await query(
      'query L($a: String, $k: String, $s: String) { libraryAssets(after: $a, kind: $k, search: $s) { assets { id kind mime bytes width height name uses createdAt } next } }',
      z.object({ libraryAssets: z.object({ assets: z.array(assetSchema), next: z.string().nullable() }) }),
      { a: o.after, k: o.kind, s: o.search || null },
    )
  ).libraryAssets

export const renameLibraryAsset = async (id: string, name: string): Promise<void> => {
  await query('mutation R($i: ID!, $n: String!) { renameLibraryAsset(id: $i, name: $n) }', z.object({ renameLibraryAsset: z.boolean() }), { i: id, n: name })
}

export const deleteLibraryAsset = async (id: string): Promise<void> => {
  await query('mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', z.object({ deleteLibraryAsset: z.boolean() }), { i: id })
}
