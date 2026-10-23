import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// The partner's live look for this host, public and read before anything renders
// (SAAS.md §3.3; apps/api src/apis/store/shell.ts).
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

export const brandSchema = z.object({
  productName: z.string(),
  primaryColor: hex.nullable(),
  accentColor: hex.nullable(),
  font: z.string().nullable(),
  corner: z.string().nullable(),
  // The partner's help centre and support contact: the app's help opens these, never DripFunnel's (SAAS.md §3.4).
  // Defaulted so a look saved by an earlier version still reads.
  helpUrl: z.string().nullable().default(null),
  supportUrl: z.string().nullable().default(null),
  supportEmail: z.string().nullable().default(null),
  files: z.object({ logoLight: z.string().nullable(), logoDark: z.string().nullable(), mark: z.string().nullable() }),
})

export type Brand = z.infer<typeof brandSchema>

const brandAnswer = z.object({ brand: brandSchema.nullable() })

export const fetchBrand = async (client: ApiClient): Promise<Brand | null> =>
  decode(brandAnswer, await client.request<unknown>(`{ brand { productName primaryColor accentColor font corner helpUrl supportUrl supportEmail files { logoLight logoDark mark } } }`, undefined, { get: true })).brand
