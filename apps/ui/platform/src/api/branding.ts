import { z } from 'zod'
import { query } from './client'

// The Branding operations on the Platform API (FIRST-RELEASE.md §8, §16): the look and words with their
// contrast report and the contract's rule on "Powered by", a contrast check for a draft, and publish.
export const brandFonts = ['Nunito', 'Source Sans 3', 'Manrope', 'Lora', 'DM Sans'] as const
export const brandCorners = ['rounded', 'soft', 'square'] as const
export const brandBackgrounds = ['sand', 'plain', 'photo'] as const
export const brandFiles = ['logoLight', 'logoDark', 'mark', 'favicon'] as const
export type BrandFile = (typeof brandFiles)[number]

export const hexColour = /^#[0-9a-fA-F]{6}$/
const hex = z.string().regex(hexColour)
const url = z.string().trim().url().max(200).or(z.literal(''))

export const brandingInput = z.object({
  look: z.object({
    productName: z.string().trim().min(1).max(60),
    primary: hex,
    accent: hex,
    font: z.enum(brandFonts),
    corner: z.enum(brandCorners),
    background: z.enum(brandBackgrounds),
    // The uploaded file's key under the partner's prefix, or '' for none yet (apps/api partnerBranding).
    files: z.object({ logoLight: z.string(), logoDark: z.string(), mark: z.string(), favicon: z.string() }),
  }),
  words: z.object({
    supportEmail: z.string().trim().email().max(254),
    supportUrl: url,
    helpUrl: url,
    termsUrl: url,
    privacyUrl: url,
    dpaUrl: url,
    impressum: z.string().trim().max(2000),
    poweredBy: z.boolean(),
  }),
})
export type BrandingInput = z.infer<typeof brandingInput>

// WCAG AA checked on the server (SAAS.md §3.3): each pair's ratio as the API words it, and the fix when one fails.
export interface ContrastReport {
  pairs: readonly { key: 'primaryOnWhite' | 'accentOnDark'; ratio: string; passes: boolean }[]
  passes: boolean
  fix: string | null
}

export type PoweredByRule = { kind: 'choice' } | { kind: 'fixedOn' }

export interface Branding extends BrandingInput {
  // Stores that see the portal and emails: what a publish changes (§8).
  affects: number
  contrast: ContrastReport
  poweredBy: PoweredByRule
  impressumRequired: boolean
  dpaRequired: boolean
  permission: { allowed: true } | { allowed: false; reason: 'OWNERS_AND_ADMINS_ONLY' }
}

export const publishRefusals = ['OWNERS_AND_ADMINS_ONLY', 'POWERED_BY_FIXED_BY_CONTRACT', 'IMPRESSUM_REQUIRED', 'INVALID_INPUT'] as const

export type PublishResult =
  | { ok: true }
  | { ok: false; reason: (typeof publishRefusals)[number] }
  | { ok: false; reason: 'CONTRAST_FAILS'; fix: string }

const contrastSchema = z.object({
  pairs: z.array(z.object({ key: z.enum(['primaryOnWhite', 'accentOnDark']), ratio: z.string(), passes: z.boolean() })),
  passes: z.boolean(),
  fix: z.string().nullable(),
})
const contrastFields = 'pairs { key ratio passes } passes fix'

const brandingSchema = z.object({
  branding: z.object({
    look: z.object({
      productName: z.string(),
      primary: z.string(),
      accent: z.string(),
      font: z.enum(brandFonts),
      corner: z.enum(brandCorners),
      background: z.enum(brandBackgrounds),
      files: z.object({ logoLight: z.string(), logoDark: z.string(), mark: z.string(), favicon: z.string() }),
    }),
    words: z.object({ supportEmail: z.string(), supportUrl: z.string(), helpUrl: z.string(), termsUrl: z.string(), privacyUrl: z.string(), dpaUrl: z.string(), impressum: z.string(), poweredBy: z.boolean() }),
    affects: z.number().int().nonnegative(),
    contrast: contrastSchema,
    poweredByRule: z.enum(['choice', 'fixedOn']),
    impressumRequired: z.boolean(),
    dpaRequired: z.boolean(),
    permission: z.object({ allowed: z.boolean(), reason: z.enum(['OWNERS_AND_ADMINS_ONLY']).nullable() }),
  }),
})

// The signed-in partner's own: the session names it, never an id from here.
export const loadBranding = async (): Promise<Branding> => {
  const { branding: b } = await query(
    `{ branding {
      look { productName primary accent font corner background files { logoLight logoDark mark favicon } }
      words { supportEmail supportUrl helpUrl termsUrl privacyUrl dpaUrl impressum poweredBy }
      affects contrast { ${contrastFields} } poweredByRule impressumRequired dpaRequired permission { allowed reason }
    } }`,
    brandingSchema,
  )
  return {
    look: b.look,
    words: b.words,
    affects: b.affects,
    contrast: b.contrast,
    poweredBy: { kind: b.poweredByRule },
    impressumRequired: b.impressumRequired,
    dpaRequired: b.dpaRequired,
    permission: b.permission.allowed ? { allowed: true } : { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' },
  }
}

export const checkContrast = async (primary: string, accent: string): Promise<ContrastReport> =>
  (await query(`query Contrast($primary: String!, $accent: String!) { checkContrast(primary: $primary, accent: $accent) { ${contrastFields} } }`, z.object({ checkContrast: contrastSchema }), { primary, accent })).checkContrast

export const publishBranding = async (input: BrandingInput): Promise<PublishResult> => {
  const { publishBranding: result } = await query(
    `mutation Publish($input: BrandingInput!) { publishBranding(input: $input) { ok reason fix field publishedAt } }`,
    z.object({ publishBranding: z.object({ ok: z.boolean(), reason: z.string().nullable(), fix: z.string().nullable(), field: z.string().nullable() }) }),
    { input },
  )
  if (result.ok) return { ok: true }
  if (result.reason === 'CONTRAST_FAILS') return { ok: false, reason: 'CONTRAST_FAILS', fix: result.fix ?? '' }
  const reason = z.enum(publishRefusals).safeParse(result.reason)
  return { ok: false, reason: reason.success ? reason.data : 'INVALID_INPUT' }
}

export const uploadRefusals = ['TOO_LARGE', 'UNSUPPORTED_TYPE', 'UNSAFE_SVG', 'FORBIDDEN', 'UNAUTHENTICATED', 'NOT_CONNECTED'] as const
export type UploadRefusal = (typeof uploadRefusals)[number]

// The raw file to `/api/uploads/brand-file` (card #219): the key it was stored under, or why not.
// No storage bucket bound reads as NOT_CONNECTED, as does no answer at all; an ended session, UNAUTHENTICATED.
export const uploadBrandFile = async (kind: BrandFile, file: Blob): Promise<{ ok: true; key: string } | { ok: false; code: UploadRefusal }> => {
  try {
    const response = await fetch(`/api/uploads/brand-file?kind=${kind}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(30_000),
    })
    const answer = z.union([z.object({ ok: z.literal(true), key: z.string().min(1) }), z.object({ ok: z.literal(false), code: z.string() })]).safeParse(await response.json())
    if (!answer.success) return { ok: false, code: 'NOT_CONNECTED' }
    if (answer.data.ok) return { ok: true, key: answer.data.key }
    const code = z.enum(uploadRefusals).safeParse(answer.data.code)
    return { ok: false, code: code.success ? code.data : 'NOT_CONNECTED' }
  } catch {
    return { ok: false, code: 'NOT_CONNECTED' }
  }
}
