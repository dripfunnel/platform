import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// The partner's live look for this host, public and read before anything renders
// (SAAS.md §3.3; apps/api src/apis/store/shell.ts).
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

export const brandSchema = z.object({
  productName: z.string(),
  primaryColor: hex.nullable(),
  accentColor: hex.nullable(),
  font: z.string().nullable(),
  corner: z.string().nullable(),
  files: z.object({ logoLight: z.string().nullable(), logoDark: z.string().nullable(), mark: z.string().nullable() }),
})

export type Brand = z.infer<typeof brandSchema>

const brandAnswer = z.object({ brand: brandSchema.nullable() })

export const fetchBrand = async (client: ApiClient): Promise<Brand | null> =>
  (await typedQuery(client)(`{ brand { productName primaryColor accentColor font corner files { logoLight logoDark mark } } }`, brandAnswer)).brand
