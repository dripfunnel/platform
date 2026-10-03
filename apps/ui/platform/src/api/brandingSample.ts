import type { PartnerRole } from '../features/shell/partnerRoles'
import { brandingInput, type Branding, type BrandingInput, type ContrastReport, type PoweredByRule, type PublishResult } from './branding'

// The prototype's two partners (designs/partner-data.js PARTNERS), served the way the Platform API would:
// the contrast worked out here, the contract's "Powered by" rule applied here, never in a component.
interface Seed {
  branding: BrandingInput
  affects: number
  poweredBy: PoweredByRule
  impressumRequired: boolean
}

const seeds: Record<string, Seed> = {
  'p-northstar': {
    branding: {
      look: { productName: 'Northstar Shops', primary: '#0F5E63', accent: '#E8C9A0', font: 'Nunito', corner: 'rounded', background: 'sand', files: { logoLight: 'northstar-shops-logo.svg', logoDark: 'northstar-shops-logo-white.svg', mark: 'northstar-mark.svg', favicon: 'favicon-64.png' } },
      words: { supportEmail: 'help@northstar.com', supportUrl: 'https://help.northstar.com', helpUrl: 'https://help.northstar.com/shops', termsUrl: 'https://northstar.com/shops/terms', privacyUrl: 'https://northstar.com/shops/privacy', dpaUrl: 'https://northstar.com/shops/dpa', impressum: '', poweredBy: false },
    },
    affects: 84,
    poweredBy: { kind: 'choice' },
    impressumRequired: false,
  },
  'p-kaufladen': {
    branding: {
      look: { productName: 'Kaufladen Shops', primary: '#1F3A5F', accent: '#F2B134', font: 'Source Sans 3', corner: 'soft', background: 'plain', files: { logoLight: 'kaufladen-shops-logo.svg', logoDark: 'kaufladen-shops-logo-white.svg', mark: 'kaufladen-mark.svg', favicon: 'favicon-64.png' } },
      words: { supportEmail: 'hilfe@kaufladen.de', supportUrl: '', helpUrl: '', termsUrl: 'https://kaufladen.de/agb', privacyUrl: 'https://kaufladen.de/datenschutz', dpaUrl: '', impressum: '', poweredBy: true },
    },
    affects: 0,
    poweredBy: { kind: 'fixedOn' },
    impressumRequired: true,
  },
}

const editors: readonly PartnerRole[] = ['partner-owner', 'partner-admin']

// WCAG 2.x relative luminance and contrast ratio, as the server checks it (SAAS.md §3.3).
const luminance = (hex: string) => {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

const ratio = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

const minimum = 4.5
const white = '#FFFFFF'
const ink = '#14181F'

const contrast = (primary: string, accent: string): ContrastReport => {
  const onPrimary = ratio(primary, white)
  const onAccent = ratio(accent, ink)
  const fix =
    onPrimary < minimum
      ? `White button text on ${primary} is ${onPrimary.toFixed(1)}:1. It needs 4.5:1 to be readable; try a darker primary.`
      : onAccent < minimum
        ? `Dark text on ${accent} is ${onAccent.toFixed(1)}:1. It needs 4.5:1; try a lighter accent.`
        : null
  return {
    pairs: [
      { key: 'primaryOnWhite', ratio: `${onPrimary.toFixed(1)}:1`, passes: onPrimary >= minimum },
      { key: 'accentOnDark', ratio: `${onAccent.toFixed(1)}:1`, passes: onAccent >= minimum },
    ],
    passes: fix === null,
    fix,
  }
}

export const createBrandingServer = (initial: Record<string, Seed>) => {
  const state = structuredClone(initial)
  // A real signed-in partner has no seed of its own until #165 wires Branding: it sees the first.
  const seedOf = (partnerId: string) => {
    const seed = state[partnerId] ?? Object.values(state)[0]
    if (!seed) throw new Error('No such partner.')
    return seed
  }

  const get = (partnerId: string, caller: PartnerRole): Branding => {
    const seed = seedOf(partnerId)
    return {
      ...structuredClone(seed.branding),
      affects: seed.affects,
      contrast: contrast(seed.branding.look.primary, seed.branding.look.accent),
      poweredBy: seed.poweredBy,
      impressumRequired: seed.impressumRequired,
      dpaRequired: seed.branding.words.dpaUrl === '',
      permission: editors.includes(caller) ? { allowed: true } : { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' },
    }
  }

  const publish = (partnerId: string, raw: BrandingInput, caller: PartnerRole): PublishResult => {
    const seed = seedOf(partnerId)
    if (!editors.includes(caller)) return { ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
    const parsed = brandingInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = parsed.data
    const report = contrast(input.look.primary, input.look.accent)
    if (report.fix) return { ok: false, reason: 'CONTRAST_FAILS', fix: report.fix }
    if (seed.poweredBy.kind === 'fixedOn' && !input.words.poweredBy) return { ok: false, reason: 'POWERED_BY_FIXED_BY_CONTRACT' }
    if (seed.impressumRequired && input.words.impressum === '') return { ok: false, reason: 'IMPRESSUM_REQUIRED' }
    seed.branding = structuredClone(input)
    return { ok: true }
  }

  return { get, contrast, publish }
}

export const brandingServer = createBrandingServer(seeds)
