import { describe, expect, it } from 'vitest'
import { changedParts, keepContent } from './content'
import { contrastRatio, minContrast } from './contrast'
import { normalize } from './normalize'
import { buildTemplate, templateOrder, templates, type TemplateKey } from './presets'
import { siteSchema } from './schema'

const ctx = { store: 'Juniper & Co.', city: 'Austin', email: 'hello@juniper.example', phone: '+1 512 555 0100' }
const keys: TemplateKey[] = ['blank', ...templateOrder]

describe('templates', () => {
  it('lists the six presets and the blank one, each building a valid site with the store in it', () => {
    expect(templateOrder).toEqual(['minimal', 'street', 'beauty', 'tech', 'food', 'luxury'])
    for (const key of keys) {
      const site = buildTemplate(key, ctx)
      expect(siteSchema.safeParse(site).success, key).toBe(true)
      expect(site.tpl).toBe(key)
      expect(site.name).toBe(templates[key].name)
      expect(site.pages.contact.email).toBe(ctx.email)
    }
    expect(buildTemplate('minimal', ctx).sections[0]).toMatchObject({ id: 's1', type: 'hero', headline: 'New in: Juniper & Co. autumn edit' })
  })

  it('keeps every preset readable (AA) as drawn', () => {
    for (const key of keys) {
      const { theme } = buildTemplate(key, ctx)
      expect(contrastRatio(theme.text, theme.bg), key).toBeGreaterThanOrEqual(minContrast)
      expect(contrastRatio(theme.accentText, theme.accent), key).toBeGreaterThanOrEqual(minContrast)
    }
  })
})

describe('normalize', () => {
  const base = buildTemplate('minimal', ctx)

  it('keeps what an answer leaves out from the previous site', () => {
    const next = normalize({ theme: { accent: '#AA3311' } }, base)
    expect(next.theme.accent).toBe('#AA3311')
    expect(next.theme.headFont).toBe(base.theme.headFont)
    expect(next.sections).toEqual(base.sections)
    expect(next.pages).toEqual(base.pages)
  })

  it('refuses colours, fonts and enums outside the schema, and clamps numbers', () => {
    const next = normalize({ theme: { bg: 'red', headFont: 'Comic Sans', radius: 99, headWeight: 'bold', imgTone: 'neon' } }, base)
    expect(next.theme.bg).toBe(base.theme.bg)
    expect(next.theme.headFont).toBe(base.theme.headFont)
    expect(next.theme.radius).toBe(28)
    expect(next.theme.headWeight).toBe(base.theme.headWeight)
    expect(next.theme.imgTone).toBe(base.theme.imgTone)
  })

  it('fixes text that would not read against its background', () => {
    const next = normalize({ theme: { bg: '#FFFFFF', text: '#EEEEEE', accent: '#FFFF00', accentText: '#FFFFFF' }, announce: { on: true, text: 'Hi', bg: '#000000', fg: '#111111' } }, base)
    expect(contrastRatio(next.theme.text, next.theme.bg)).toBeGreaterThanOrEqual(minContrast)
    expect(contrastRatio(next.theme.accentText, next.theme.accent)).toBeGreaterThanOrEqual(minContrast)
    expect(contrastRatio(next.announce.fg, next.announce.bg)).toBeGreaterThanOrEqual(minContrast)
  })

  it('drops unknown section types, keeps at most 12, and makes ids unique', () => {
    const many = Array.from({ length: 15 }, () => ({ id: 'dup', type: 'text', headline: 'x', body: 'y' }))
    const next = normalize({ sections: [{ type: 'carousel' }, ...many] }, base)
    expect(next.sections).toHaveLength(12)
    expect(new Set(next.sections.map((s) => s.id)).size).toBe(12)
    expect(next.sections[0]?.id).toBe('dup')
  })

  it('cuts text to its limit and ignores fields the schema lacks, such as prices', () => {
    const next = normalize({ sections: [{ id: 'h', type: 'hero', headline: 'x'.repeat(200), price: 1, layout: 'split' }], products: [{ price: 0 }] }, base)
    expect(next.sections[0]).toEqual({ id: 'h', type: 'hero', layout: 'split', headline: 'x'.repeat(80), sub: '', cta: 'Shop now' })
    expect(next).not.toHaveProperty('products')
  })

  it('turns anything at all into a valid site', () => {
    for (const raw of [null, 'site', 42, [], { theme: [] }, { sections: 'x', header: { menu: [1, null, ''] } }]) {
      expect(siteSchema.safeParse(normalize(raw)).success).toBe(true)
    }
  })
})

describe('keepContent', () => {
  it('takes the new look and keeps the merchant’s words', () => {
    const mine = normalize({ header: { menu: ['Shop', 'Our story'] }, sections: [{ id: 'a', type: 'hero', headline: 'Mine', sub: 'Our words', cta: 'Go', layout: 'split' }] }, buildTemplate('minimal', ctx))
    const next = keepContent(buildTemplate('street', ctx), mine)
    expect(next.theme).toEqual(buildTemplate('street', ctx).theme)
    expect(next.header.menu).toEqual(['Shop', 'Our story'])
    expect(next.sections.find((s) => s.type === 'hero')).toMatchObject({ headline: 'Mine', sub: 'Our words', cta: 'Go', layout: 'full' })
    expect(next.pages).toEqual(mine.pages)
  })
})

describe('changedParts', () => {
  it('names the parts and the sections that differ', () => {
    const a = buildTemplate('minimal', ctx)
    const b = normalize({ theme: { accent: '#AA3311' }, sections: a.sections.map((s) => (s.id === 's2' ? { ...s, title: 'Fresh' } : s)) }, a)
    expect(changedParts(a, b)).toEqual(['theme', 's2'])
    expect(changedParts(a, a)).toEqual([])
  })
})
