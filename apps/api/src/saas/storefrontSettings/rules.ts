import { z } from 'zod'
import { isUuid } from '#core/ids'
import type { BrandWrite } from '#db/scoped/storefrontSettings'
import type { StoreAddress } from '#db/scoped/storeInfo'

// What Storefront › Site settings may hold (FIRST-RELEASE §14; DATA-MODEL §7.8): the brand's files are the store's own
// ids, colours are hex, social links are https addresses on the network's own host, and the home page's words fit
// search results (title ≤ 60, description ≤ 155).

export const socialNetworks = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'whatsapp'] as const
export type SocialNetwork = (typeof socialNetworks)[number]

const networkHosts: Record<SocialNetwork, readonly string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  x: ['x.com', 'twitter.com'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  whatsapp: ['wa.me', 'whatsapp.com'],
}

// A handle as each network writes it, and the profile address it stands for.
const handles: Record<SocialNetwork, { pattern: RegExp; url: (handle: string) => string }> = {
  instagram: { pattern: /^@?([A-Za-z0-9._]{1,30})$/, url: (h) => `https://www.instagram.com/${h}` },
  facebook: { pattern: /^@?([A-Za-z0-9.]{5,50})$/, url: (h) => `https://www.facebook.com/${h}` },
  x: { pattern: /^@?([A-Za-z0-9_]{1,15})$/, url: (h) => `https://x.com/${h}` },
  youtube: { pattern: /^@?([A-Za-z0-9._-]{3,30})$/, url: (h) => `https://www.youtube.com/@${h}` },
  tiktok: { pattern: /^@?([A-Za-z0-9._]{2,24})$/, url: (h) => `https://www.tiktok.com/@${h}` },
  whatsapp: { pattern: /^(\+?[0-9][0-9 ()-]{6,19})$/, url: (h) => `https://wa.me/${h.replace(/\D/g, '')}` },
}

const maxLinkLength = 300

/** The network's profile address for a handle or an address on its own host; null for anything else. */
export const socialLink = (network: SocialNetwork, raw: string): string | null => {
  const value = raw.trim()
  if (value === '' || value.length > maxLinkLength) return null
  const handle = handles[network].pattern.exec(value)?.[1]
  if (handle) return handles[network].url(handle)
  const address = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null
  if (!networkHosts[network].some((h) => host === h || host.endsWith(`.${h}`))) return null
  if (url.pathname === '/' && url.search === '') return null
  url.hash = ''
  return url.toString()
}

/** `#rgb` or `#rrggbb`, with or without the `#`, as `#rrggbb`. */
export const hexColour = (raw: string): string | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim())
  if (!m?.[1]) return null
  const hex = m[1].toLowerCase()
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`
}

const optionalText = z.string().nullish()
const addressInput = z.strictObject({ street: optionalText, city: optionalText, postal: optionalText, region: optionalText })

export const brandInput = z.strictObject({
  shopName: optionalText,
  logoAssetId: z.string(),
  faviconAssetId: optionalText,
  primaryColour: optionalText,
  secondaryColour: optionalText,
  tagline: optionalText,
  description: optionalText,
  social: z.strictObject(Object.fromEntries(socialNetworks.map((n) => [n, optionalText])) as Record<SocialNetwork, typeof optionalText>).nullish(),
  contactEmail: optionalText,
  contactPhone: optionalText,
  contactAddress: addressInput.nullish(),
  voice: optionalText,
})

export const seoInput = z.strictObject({ title: optionalText, description: optionalText, shareImageAssetId: optionalText })

export type SettingsRefusal = { reason: 'INVALID_INPUT'; field: string } | { reason: 'INVALID_EMAIL' } | { reason: 'INVALID_IMAGE'; field: 'logo' | 'favicon' | 'shareImage' }

export class SettingsInvalid extends Error {
  constructor(readonly refusal: SettingsRefusal) {
    super(refusal.reason)
  }
}

const invalid = (field: string): never => {
  throw new SettingsInvalid({ reason: 'INVALID_INPUT', field })
}

/** Trimmed, null when empty; refused past `max`. */
const textOf = (value: string | null | undefined, max: number, field: string): string | null => {
  const text = (value ?? '').trim()
  if (text.length > max) invalid(field)
  return text === '' ? null : text
}

const idOf = (value: string | null | undefined, field: 'logo' | 'favicon' | 'shareImage'): string | null => {
  if (value === null || value === undefined || value === '') return null
  const id = value.toLowerCase()
  if (!isUuid(id)) throw new SettingsInvalid({ reason: 'INVALID_IMAGE', field })
  return id
}

const colourOf = (value: string | null | undefined, field: string): string | null => {
  if (value === null || value === undefined || value.trim() === '') return null
  return hexColour(value) ?? invalid(field)
}

export type CleanBrand = BrandWrite & { shopName: string | null }

export const cleanBrand = (raw: unknown): CleanBrand => {
  const parsed = brandInput.safeParse(raw)
  if (!parsed.success) return invalid(String(parsed.error.issues[0]?.path[0] ?? 'input'))
  const input = parsed.data
  const shopName = input.shopName === null || input.shopName === undefined ? null : (textOf(input.shopName, 80, 'shopName') ?? invalid('shopName'))
  const logo = idOf(input.logoAssetId, 'logo')
  if (!logo) throw new SettingsInvalid({ reason: 'INVALID_IMAGE', field: 'logo' })
  const social: Record<string, string> = {}
  for (const network of socialNetworks) {
    const value = input.social?.[network]
    if (value === null || value === undefined || value.trim() === '') continue
    social[network] = socialLink(network, value) ?? invalid(`social.${network}`)
  }
  const contactEmail = textOf(input.contactEmail, 320, 'contactEmail')
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) throw new SettingsInvalid({ reason: 'INVALID_EMAIL' })
  const a = input.contactAddress
  const contactAddress: StoreAddress | null = a
    ? { street: textOf(a.street, 200, 'contactAddress') ?? '', city: textOf(a.city, 100, 'contactAddress') ?? '', postal: textOf(a.postal, 20, 'contactAddress') ?? '', region: textOf(a.region, 100, 'contactAddress') ?? '' }
    : null
  return {
    shopName,
    logoAssetId: logo,
    faviconAssetId: idOf(input.faviconAssetId, 'favicon'),
    primaryColour: colourOf(input.primaryColour, 'primaryColour'),
    secondaryColour: colourOf(input.secondaryColour, 'secondaryColour'),
    tagline: textOf(input.tagline, 100, 'tagline'),
    description: textOf(input.description, 300, 'description'),
    social,
    contactEmail,
    contactPhone: textOf(input.contactPhone, 40, 'contactPhone'),
    contactAddress: contactAddress && Object.values(contactAddress).some((v) => v !== '') ? contactAddress : null,
    voice: textOf(input.voice, 60, 'voice'),
  }
}

export const maxSeoTitle = 60
export const maxSeoDescription = 155

export const cleanSeo = (raw: unknown): { title: string | null; description: string | null; shareAssetId: string | null } => {
  const parsed = seoInput.safeParse(raw)
  if (!parsed.success) return invalid(String(parsed.error.issues[0]?.path[0] ?? 'input'))
  return {
    title: textOf(parsed.data.title, maxSeoTitle, 'title'),
    description: textOf(parsed.data.description, maxSeoDescription, 'description'),
    shareAssetId: idOf(parsed.data.shareImageAssetId, 'shareImage'),
  }
}
