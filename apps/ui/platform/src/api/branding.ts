import { z } from 'zod'
import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'
import { brandingServer } from './brandingSample'

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
    files: z.object({ logoLight: z.string().min(1), logoDark: z.string().min(1), mark: z.string().min(1), favicon: z.string().min(1) }),
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

export type PublishResult =
  | { ok: true }
  | { ok: false; reason: 'OWNERS_AND_ADMINS_ONLY' | 'POWERED_BY_FIXED_BY_CONTRACT' | 'IMPRESSUM_REQUIRED' | 'INVALID_INPUT' }
  | { ok: false; reason: 'CONTRAST_FAILS'; fix: string }

const notConnected = () => Promise.reject(new Error('The Platform API has no branding operations yet.'))

// Seam: the sample stands in for the Platform API's branding operations until they land; it answers only
// where the ?state= harness does, and a production build shows the error state.
export const loadBranding = (partnerId: string, caller: PartnerRole): Promise<Branding> =>
  harnessEnabled ? Promise.resolve(brandingServer.get(partnerId, caller)) : notConnected()

export const checkContrast = (primary: string, accent: string): Promise<ContrastReport> =>
  harnessEnabled ? Promise.resolve(brandingServer.contrast(primary, accent)) : notConnected()

export const publishBranding = (partnerId: string, input: BrandingInput, caller: PartnerRole): Promise<PublishResult> =>
  harnessEnabled ? Promise.resolve(brandingServer.publish(partnerId, input, caller)) : notConnected()
