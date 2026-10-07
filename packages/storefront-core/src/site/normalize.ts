import { readableOn } from './contrast'
import { fonts, type Font } from './fonts'
import { limits, sectionTypes, siteSchema, type SectionType, type Site, type SiteSection, type SiteTheme } from './schema'

// Turns anything (the AI's answer, an old version) into a valid site: unknown fields dropped,
// values clamped, text cut to length, contrast fixed. Ported from designs/storefront-lib.js.

type Loose = Record<string, unknown>

const record = (v: unknown): Loose => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {})
const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim()) ? v.trim() : fallback)
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v : fallback).slice(0, max)
const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const x = Math.round(Number(v))
  return Number.isNaN(x) ? fallback : Math.max(min, Math.min(max, x))
}
const labels = (v: unknown, count: number, max: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .slice(0, count)
    .map((x) => x.trim().slice(0, max))
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
const font = (v: unknown, fallback: Font): Font => (typeof v === 'string' && v in fonts ? (v as Font) : fallback)

export const defaultTheme: SiteTheme = {
  bg: '#FFFFFF',
  surface: '#F5F5F4',
  text: '#222222',
  muted: '#5F5F5F',
  accent: '#2B2B2B',
  accentText: '#FFFFFF',
  headFont: 'Manrope',
  bodyFont: 'Work Sans',
  headWeight: 700,
  headCase: 'none',
  radius: 6,
  imgTone: 'soft',
}

const normalizeTheme = (raw: Loose, prev: SiteTheme): SiteTheme => {
  const bg = hex(raw.bg, prev.bg)
  const accent = hex(raw.accent, prev.accent)
  return {
    bg,
    surface: hex(raw.surface, prev.surface),
    text: readableOn(bg, hex(raw.text, prev.text)),
    muted: readableOn(bg, hex(raw.muted, prev.muted)),
    accent,
    accentText: readableOn(accent, hex(raw.accentText, prev.accentText)),
    headFont: font(raw.headFont, prev.headFont),
    bodyFont: font(raw.bodyFont, prev.bodyFont),
    headWeight: num(raw.headWeight, 300, 900, prev.headWeight),
    headCase: raw.headCase === 'uppercase' ? 'uppercase' : raw.headCase === 'none' ? 'none' : prev.headCase,
    radius: num(raw.radius, 0, 28, prev.radius),
    imgTone: oneOf(raw.imgTone, ['soft', 'vivid', 'dark', 'mono'], prev.imgTone),
  }
}

const normalizeSection = (x: Loose, id: string): SiteSection | undefined => {
  switch (x.type as SectionType) {
    case 'hero':
      return { id, type: 'hero', layout: oneOf(x.layout, ['split', 'full', 'centered'], 'split'), headline: str(x.headline, 80, 'Welcome'), sub: str(x.sub, 160), cta: str(x.cta, 28, 'Shop now') }
    case 'products':
      return { id, type: 'products', title: str(x.title, 50, 'Products'), cols: num(x.cols, 2, 5, 4), count: num(x.count, 3, 12, 8), card: oneOf(x.card, ['plain', 'boxed'], 'plain'), aspect: oneOf(x.aspect, ['square', 'portrait'], 'square') }
    case 'categories': {
      const items = labels(x.items, limits.categories, 24)
      return { id, type: 'categories', title: str(x.title, 50, 'Shop by category'), items: items.length ? items : ['New', 'Bestsellers', 'Gifts'] }
    }
    case 'banner':
      return { id, type: 'banner', headline: str(x.headline, 80), sub: str(x.sub, 160), cta: str(x.cta, 28), tone: oneOf(x.tone, ['accent', 'dark', 'light'], 'accent') }
    case 'features':
      return {
        id,
        type: 'features',
        title: str(x.title, 50),
        items: (Array.isArray(x.items) ? x.items : [])
          .map(record)
          .map((i) => ({ title: str(i.title, 40).trim(), body: str(i.body, 100) }))
          .filter((i) => i.title)
          .slice(0, limits.features),
      }
    case 'testimonial':
      return { id, type: 'testimonial', quote: str(x.quote, 220), author: str(x.author, 60) }
    case 'newsletter':
      return { id, type: 'newsletter', headline: str(x.headline, 80, 'Stay in touch'), sub: str(x.sub, 140), cta: str(x.cta, 24, 'Sign up') }
    case 'text':
      return { id, type: 'text', headline: str(x.headline, 80), body: str(x.body, 600), align: x.align === 'center' ? 'center' : 'left' }
    default:
      return undefined
  }
}

const normalizeSections = (raw: unknown, prev: readonly SiteSection[]): SiteSection[] => {
  const list = Array.isArray(raw) ? raw.map(record) : prev.map(record)
  const used = new Set<string>()
  let next = 0
  const freshId = () => {
    let id: string
    do id = `s${++next + 20}`
    while (used.has(id))
    return id
  }
  return list
    .filter((x) => sectionTypes.includes(x.type as SectionType))
    .slice(0, limits.sections)
    .flatMap((x) => {
      const asked = typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(x.id) && !used.has(x.id) ? x.id : freshId()
      used.add(asked)
      const section = normalizeSection(x, asked)
      return section ? [section] : []
    })
}

/** A valid site from `raw`, taking what `raw` leaves out (or gets wrong) from `prev`. */
export const normalize = (raw: unknown, prev?: Site): Site => {
  const s = record(raw)
  const theme = normalizeTheme(record(s.theme), prev?.theme ?? defaultTheme)
  const a = { ...prev?.announce, ...record(s.announce) }
  const h = { ...prev?.header, ...record(s.header) }
  const f = { ...prev?.footer, ...record(s.footer) }
  const pages = record(s.pages)
  const about = record(pages.about)
  const contact = { ...prev?.pages.contact, ...record(pages.contact) }
  const menu = labels(h.menu, limits.menu, 20)
  const announceBg = hex(a.bg, theme.text)
  const headerBg = hex(h.bg, theme.bg)
  const site: Site = {
    tpl: str(s.tpl, 24).trim() || prev?.tpl || 'blank',
    name: str(s.name, 40).trim() || prev?.name || 'Custom',
    theme,
    announce: { on: a.on === true, text: str(a.text, 100), bg: announceBg, fg: readableOn(announceBg, hex(a.fg, theme.bg)) },
    header: { style: h.style === 'center' ? 'center' : 'left', menu: menu.length ? menu : ['Shop', 'About', 'Contact'], bg: headerBg, fg: readableOn(headerBg, hex(h.fg, theme.text)) },
    sections: normalizeSections(s.sections, prev?.sections ?? []),
    footer: { text: str(f.text, 160), links: labels(f.links, limits.footerLinks, 24), tone: oneOf(f.tone, ['light', 'dark', 'accent'], 'light') },
    pages: {
      about: { headline: str(about.headline, 80, prev?.pages.about.headline ?? 'About us'), body: str(about.body, 1200, prev?.pages.about.body ?? '') },
      contact: {
        headline: str(contact.headline, 80, 'Get in touch'),
        body: str(contact.body, 400),
        email: str(contact.email, 254),
        phone: str(contact.phone, 40),
        address: str(contact.address, 200),
      },
    },
  }
  return siteSchema.parse(site)
}
