import { z } from 'zod'
import { codeChannelsSchema, type CodeChannels } from './auth'
import { query } from './client'

// The partner's live look for this hostname (FIRST-RELEASE.md §2; apps/api src/apis/store/shell.ts),
// public, read before anything renders.
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

const brandSchema = z.object({
  brand: z
    .object({
      productName: z.string(),
      primaryColor: hex.nullable(),
      accentColor: hex.nullable(),
      font: z.string().nullable(),
      corner: z.string().nullable(),
      background: z.string().nullable(),
      files: z.object({ logoLight: z.string().nullable(), logoDark: z.string().nullable(), mark: z.string().nullable(), favicon: z.string().nullable() }),
      supportEmail: z.string().nullable(),
      supportUrl: z.string().nullable(),
      helpUrl: z.string().nullable(),
      termsUrl: z.string().nullable(),
      privacyUrl: z.string().nullable(),
      poweredBy: z.boolean(),
      // Whether Sign in and Create your store offer Google: the partner's own client is on (#1046).
      googleSignIn: z.boolean(),
    })
    .nullable(),
})

export type Brand = NonNullable<z.infer<typeof brandSchema>['brand']>

export const loadBrand = async (): Promise<Brand | null> =>
  (await query(`{ brand { productName primaryColor accentColor font corner background files { logoLight logoDark mark favicon } supportEmail supportUrl helpUrl termsUrl privacyUrl poweredBy googleSignIn } }`, brandSchema)).brand

/** Whether sign-up will ask for a number (the partner's WhatsApp is on, SAAS.md §4.1); read by sign-up alone, not with the look. */
export const loadCodeChannels = async (): Promise<CodeChannels | null> =>
  (await query(`{ brand { codeChannels { whatsapp sms } } }`, z.object({ brand: z.object({ codeChannels: codeChannelsSchema.nullable() }).nullable() }))).brand?.codeChannels ?? null
