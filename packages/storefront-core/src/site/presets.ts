import { normalize, defaultTheme } from './normalize'
import type { Site } from './schema'

// The template presets of designs/storefront-lib.js (storefront DESIGN §4), built with the
// store's own name, city and contact. Their words are samples the merchant replaces.

export type PresetContext = { store: string; city: string; email: string; phone: string }

type Draft = Omit<Site, 'tpl' | 'name' | 'sections'> & { sections: Omit<Site['sections'][number], 'id'>[] }

const pages = (c: PresetContext, about: string): Draft['pages'] => ({
  about: { headline: 'About ' + c.store, body: about },
  contact: { headline: 'Get in touch', body: 'Questions about an order, sizing or anything else — we reply within one working day.', email: c.email, phone: c.phone, address: c.city },
})

type Preset = { name: string; tag: string; desc: string; build: (c: PresetContext) => Draft }

const presets = {
    minimal: {
      name: 'Linen', tag: 'Minimal fashion', desc: 'Light, roomy and quiet. Big photos, small type, nothing in the way.',
      build: (c) => ({
        theme: { bg: '#FAF8F5', surface: '#FFFFFF', text: '#1C1B19', muted: '#68645C', accent: '#1C1B19', accentText: '#FFFFFF', headFont: 'DM Sans', bodyFont: 'DM Sans', headWeight: 500, headCase: 'none', radius: 2, imgTone: 'soft' },
        announce: { on: true, text: 'Free returns within 30 days', bg: '#1C1B19', fg: '#FAF8F5' },
        header: { style: 'left', menu: ['Shop', 'New in', 'About', 'Contact'], bg: '#FAF8F5', fg: '#1C1B19' },
        sections: [
          { type: 'hero', layout: 'split', headline: 'New in: ' + c.store + ' autumn edit', sub: 'Made to last, sent from ' + c.city + '.', cta: 'Shop now' },
          { type: 'products', title: 'New arrivals', cols: 4, count: 8, card: 'plain', aspect: 'portrait' },
          { type: 'text', headline: 'Made slowly, worn for years', body: 'Natural fabrics, simple cuts and seams that hold. We make fewer things and make them well.', align: 'center' },
          { type: 'newsletter', headline: 'Hear about new pieces first', sub: 'One email a month. No noise.', cta: 'Sign up' }
        ],
        footer: { text: 'Everyday clothes, made to last.', links: ['Shipping', 'Returns', 'Size guide', 'Contact'], tone: 'light' },
        pages: pages(c, c.store + ' started with one idea: clothes you reach for every day should be the best-made ones you own.\n\nEverything is cut in small runs from natural fabrics and finished by people we know by name.')
      })
    },
    street: {
      name: 'Concrete', tag: 'Bold streetwear', desc: 'Loud type, hard edges and a bright accent. Built around drops.',
      build: (c) => ({
        theme: { bg: '#EFEFEC', surface: '#FFFFFF', text: '#0D0D0D', muted: '#46463F', accent: '#D7F205', accentText: '#0D0D0D', headFont: 'Archivo Black', bodyFont: 'Work Sans', headWeight: 400, headCase: 'uppercase', radius: 0, imgTone: 'vivid' },
        announce: { on: true, text: 'Drop 07 lands Friday, 6 pm', bg: '#0D0D0D', fg: '#D7F205' },
        header: { style: 'center', menu: ['Drop 07', 'Shop all', 'Lookbook', 'About'], bg: '#0D0D0D', fg: '#FFFFFF' },
        sections: [
          { type: 'hero', layout: 'full', headline: 'Built for the street', sub: 'Heavyweight basics in small runs.', cta: 'Shop the drop' },
          { type: 'categories', title: 'Shop by type', items: ['Tees', 'Hoodies', 'Pants', 'Caps'] },
          { type: 'products', title: 'Latest drop', cols: 3, count: 6, card: 'boxed', aspect: 'square' },
          { type: 'banner', headline: 'Members shop first', sub: 'Sign up and we’ll tell you before every drop.', cta: 'Join', tone: 'accent' }
        ],
        footer: { text: c.store + ' — made in small runs.', links: ['Shipping', 'Returns', 'Instagram', 'Contact'], tone: 'dark' },
        pages: pages(c, 'We make the clothes we wanted and couldn’t find: heavy cotton, clean graphics, fits that last.\n\nEvery drop is small, so nothing ends up in landfill.')
      })
    },
    beauty: {
      name: 'Bloom', tag: 'Beauty & wellness', desc: 'Soft colour, rounded shapes and calm serif headings.',
      build: (c) => ({
        theme: { bg: '#FBF3EE', surface: '#FFFFFF', text: '#3A2724', muted: '#76605A', accent: '#A9523F', accentText: '#FFFFFF', headFont: 'Lora', bodyFont: 'Nunito', headWeight: 500, headCase: 'none', radius: 18, imgTone: 'soft' },
        announce: { on: true, text: 'Free samples with every order', bg: '#F1DCD1', fg: '#3A2724' },
        header: { style: 'center', menu: ['Shop', 'Skin', 'Body', 'Our story', 'Contact'], bg: '#FBF3EE', fg: '#3A2724' },
        sections: [
          { type: 'hero', layout: 'centered', headline: 'Gentle care, every day', sub: 'Simple formulas, made in small batches.', cta: 'Find your routine' },
          { type: 'features', title: '', items: [{ title: 'Kind ingredients', body: 'Short lists you can read.' }, { title: 'Never tested on animals', body: 'Certified, every product.' }, { title: 'Refillable', body: 'Send empties back for free.' }] },
          { type: 'products', title: 'Bestsellers', cols: 4, count: 4, card: 'boxed', aspect: 'portrait' },
          { type: 'testimonial', quote: 'The only cleanser that hasn’t upset my skin. I’m on my fourth bottle.', author: 'Amira, verified buyer' },
          { type: 'newsletter', headline: '10% off your first order', sub: 'Plus routines and early access.', cta: 'Get my code' }
        ],
        footer: { text: 'Made in small batches.', links: ['Ingredients', 'Shipping', 'Returns', 'Contact'], tone: 'light' },
        pages: pages(c, 'We started mixing in a kitchen because nothing on the shelf suited sensitive skin.\n\nToday every batch is still small, tested and labelled in plain words.')
      })
    },
    tech: {
      name: 'Circuit', tag: 'Electronics & tech', desc: 'Dark, sharp and spec-led. Clear prices and trust signals up front.',
      build: (c) => ({
        theme: { bg: '#0E1116', surface: '#171C24', text: '#E7ECF2', muted: '#9DA9B8', accent: '#3D8BFF', accentText: '#FFFFFF', headFont: 'Space Grotesk', bodyFont: 'Inter', headWeight: 700, headCase: 'none', radius: 10, imgTone: 'dark' },
        announce: { on: true, text: 'Two-year warranty on everything', bg: '#3D8BFF', fg: '#FFFFFF' },
        header: { style: 'left', menu: ['Shop', 'Compare', 'Support', 'About'], bg: '#0E1116', fg: '#E7ECF2' },
        sections: [
          { type: 'hero', layout: 'split', headline: 'Gear that just works', sub: 'Tested, explained and sent the next day.', cta: 'Shop all' },
          { type: 'categories', title: 'Browse', items: ['Audio', 'Charging', 'Cables', 'Accessories'] },
          { type: 'products', title: 'Popular right now', cols: 4, count: 8, card: 'boxed', aspect: 'square' },
          { type: 'features', title: 'Why buy here', items: [{ title: 'Next-day dispatch', body: 'Order by 4 pm.' }, { title: '2-year warranty', body: 'On every item.' }, { title: '30-day returns', body: 'No questions.' }, { title: 'Real support', body: 'People, not bots.' }] },
          { type: 'newsletter', headline: 'Deals and new releases', sub: 'Twice a month.', cta: 'Subscribe' }
        ],
        footer: { text: 'Gear, explained.', links: ['Support', 'Warranty', 'Shipping', 'Returns'], tone: 'dark' },
        pages: pages(c, 'We test everything we sell and write down what we find, so you can buy once.\n\nIf something stops working, we fix it or replace it.')
      })
    },
    food: {
      name: 'Market', tag: 'Food & grocery', desc: 'Warm, friendly and easy to browse. Categories first, delivery promise on top.',
      build: (c) => ({
        theme: { bg: '#FFFCF3', surface: '#FFFFFF', text: '#1F2D1C', muted: '#56644F', accent: '#2F7A35', accentText: '#FFFFFF', headFont: 'Nunito', bodyFont: 'Nunito', headWeight: 800, headCase: 'none', radius: 14, imgTone: 'vivid' },
        announce: { on: true, text: 'Order by 2 pm for same-day delivery in ' + c.city, bg: '#2F7A35', fg: '#FFFFFF' },
        header: { style: 'left', menu: ['Shop', 'Fresh', 'Pantry', 'Offers', 'About'], bg: '#FFFCF3', fg: '#1F2D1C' },
        sections: [
          { type: 'hero', layout: 'split', headline: 'Fresh from the market, at your door', sub: 'Picked this morning from growers near ' + c.city + '.', cta: 'Start shopping' },
          { type: 'categories', title: 'Shop by aisle', items: ['Fruit & veg', 'Bakery', 'Dairy', 'Pantry', 'Drinks', 'Snacks'] },
          { type: 'products', title: 'This week’s picks', cols: 5, count: 10, card: 'boxed', aspect: 'square' },
          { type: 'banner', headline: 'Build a weekly box', sub: 'Choose once, skip any week.', cta: 'Make my box', tone: 'accent' }
        ],
        footer: { text: 'Local food, delivered.', links: ['Delivery areas', 'FAQs', 'Our growers', 'Contact'], tone: 'light' },
        pages: pages(c, 'We buy from growers and bakers near ' + c.city + ' and bring it to you the same day.\n\nShorter trips mean fresher food and fairer prices for the people who make it.')
      })
    },
    luxury: {
      name: 'Atelier', tag: 'Luxury editorial', desc: 'Magazine-like pacing. Large serif type, muted tones, lots of space.',
      build: (c) => ({
        theme: { bg: '#F4EFE7', surface: '#FBF8F3', text: '#1A1714', muted: '#6A6157', accent: '#1A1714', accentText: '#F4EFE7', headFont: 'Playfair Display', bodyFont: 'Work Sans', headWeight: 400, headCase: 'none', radius: 0, imgTone: 'mono' },
        announce: { on: false, text: 'Private appointments available', bg: '#1A1714', fg: '#F4EFE7' },
        header: { style: 'center', menu: ['Collection', 'Atelier', 'Journal', 'Contact'], bg: '#F4EFE7', fg: '#1A1714' },
        sections: [
          { type: 'hero', layout: 'full', headline: 'The Autumn Collection', sub: 'Cut and finished by hand.', cta: 'Discover' },
          { type: 'text', headline: 'A quieter kind of luxury', body: 'Each piece is made to order in our ' + c.city + ' atelier, from cloth chosen for how it ages.', align: 'center' },
          { type: 'products', title: 'The collection', cols: 3, count: 6, card: 'plain', aspect: 'portrait' },
          { type: 'testimonial', quote: 'Clothes that feel inherited the day you buy them.', author: 'The Weekend Review' },
          { type: 'newsletter', headline: 'Private appointments', sub: 'Leave your email and we’ll be in touch.', cta: 'Request' }
        ],
        footer: { text: 'Made to order.', links: ['Appointments', 'Care', 'Delivery', 'Contact'], tone: 'dark' },
        pages: pages(c, 'Founded in ' + c.city + ', ' + c.store + ' makes a small number of pieces each season, by hand and to order.\n\nWe would rather make one thing perfectly than ten things quickly.')
      })
    }
,
  blank: {
    name: 'Start from scratch',
    tag: 'Blank',
    desc: 'A plain header, banner, product grid and footer. Describe your shop and the AI styles it.',
    build: (c) => ({
      theme: { ...defaultTheme },
      announce: { on: false, text: 'Add a short message for shoppers', bg: '#222222', fg: '#FFFFFF' },
      header: { style: 'left', menu: ['Shop', 'About', 'Contact'], bg: '#FFFFFF', fg: '#222222' },
      sections: [
        { type: 'hero', layout: 'centered', headline: 'Welcome to ' + c.store, sub: 'Tell the AI what you sell and how it should feel.', cta: 'Shop now' },
        { type: 'products', title: 'Products', cols: 4, count: 8, card: 'plain', aspect: 'square' },
      ],
      footer: { text: '', links: ['Shipping', 'Returns', 'Contact'], tone: 'light' },
      pages: pages(c, 'Write a few lines about who you are and why you started.'),
    }),
  },
} satisfies Record<string, Preset>

export type TemplateKey = keyof typeof presets
/** The gallery's order; "Start from scratch" comes first in the gallery, on its own. */
export const templateOrder = ['minimal', 'street', 'beauty', 'tech', 'food', 'luxury'] as const satisfies readonly TemplateKey[]

export const templates: Record<TemplateKey, Pick<Preset, 'name' | 'tag' | 'desc'>> = Object.fromEntries(
  Object.entries(presets).map(([k, p]) => [k, { name: p.name, tag: p.tag, desc: p.desc }]),
) as Record<TemplateKey, Pick<Preset, 'name' | 'tag' | 'desc'>>

export const isTemplateKey = (key: string): key is TemplateKey => Object.hasOwn(presets, key)

/** The site a template starts with, for this store. */
export const buildTemplate = (key: TemplateKey, c: PresetContext): Site => {
  const p: Preset = presets[key]
  const draft = p.build(c)
  return normalize({ ...draft, tpl: key, name: p.name, sections: draft.sections.map((s, i) => ({ id: `s${i + 1}`, ...s })) })
}
