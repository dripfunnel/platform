import { z } from 'zod'
import { fontNames } from './fonts'

// The site-data schema (storefront ARCHITECTURE §2.1, DESIGN §2). Stored drafts and versions
// always parse; the AI's raw answer goes through normalize() first.

export const hexColour = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
const text = (max: number) => z.string().max(max)
const label = (max: number) => z.string().trim().min(1).max(max)

export const limits = {
  sections: 12,
  menu: 6,
  footerLinks: 6,
  categories: 6,
  features: 4,
} as const

export const themeSchema = z.object({
  bg: hexColour,
  surface: hexColour,
  text: hexColour,
  muted: hexColour,
  accent: hexColour,
  accentText: hexColour,
  headFont: z.enum(fontNames),
  bodyFont: z.enum(fontNames),
  headWeight: z.number().int().min(300).max(900),
  headCase: z.enum(['none', 'uppercase']),
  radius: z.number().int().min(0).max(28),
  imgTone: z.enum(['soft', 'vivid', 'dark', 'mono']),
})

const id = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/)

export const sectionSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('hero'), layout: z.enum(['split', 'full', 'centered']), headline: text(80), sub: text(160), cta: text(28) }),
  z.object({
    id,
    type: z.literal('products'),
    title: text(50),
    cols: z.number().int().min(2).max(5),
    count: z.number().int().min(3).max(12),
    card: z.enum(['plain', 'boxed']),
    aspect: z.enum(['square', 'portrait']),
  }),
  z.object({ id, type: z.literal('categories'), title: text(50), items: z.array(label(24)).min(1).max(limits.categories) }),
  z.object({ id, type: z.literal('banner'), headline: text(80), sub: text(160), cta: text(28), tone: z.enum(['accent', 'dark', 'light']) }),
  z.object({ id, type: z.literal('features'), title: text(50), items: z.array(z.object({ title: label(40), body: text(100) })).max(limits.features) }),
  z.object({ id, type: z.literal('testimonial'), quote: text(220), author: text(60) }),
  z.object({ id, type: z.literal('newsletter'), headline: text(80), sub: text(140), cta: text(24) }),
  z.object({ id, type: z.literal('text'), headline: text(80), body: text(600), align: z.enum(['left', 'center']) }),
])

export const sectionTypes = ['hero', 'products', 'categories', 'banner', 'features', 'testimonial', 'newsletter', 'text'] as const

export const siteSchema = z.object({
  tpl: label(24),
  name: label(40),
  theme: themeSchema,
  announce: z.object({ on: z.boolean(), text: text(100), bg: hexColour, fg: hexColour }),
  header: z.object({ style: z.enum(['left', 'center']), menu: z.array(label(20)).min(1).max(limits.menu), bg: hexColour, fg: hexColour }),
  sections: z
    .array(sectionSchema)
    .max(limits.sections)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'Section ids must be unique.'),
  footer: z.object({ text: text(160), links: z.array(label(24)).max(limits.footerLinks), tone: z.enum(['light', 'dark', 'accent']) }),
  pages: z.object({
    about: z.object({ headline: text(80), body: text(1200) }),
    contact: z.object({ headline: text(80), body: text(400), email: text(254), phone: text(40), address: text(200) }),
  }),
})

export type SiteTheme = z.infer<typeof themeSchema>
export type SiteSection = z.infer<typeof sectionSchema>
export type SectionType = SiteSection['type']
export type Site = z.infer<typeof siteSchema>
