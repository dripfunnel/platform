import type { CatalogueSnapshot } from './snapshot.js'

// The edge-case catalogue every theme is rendered against at publish (storefront ARCHITECTURE §10): the store's own
// snapshot pushed to the limits a real store reaches, so a design that only works with tidy data is refused.

export type EdgeCase = { name: string; snapshot: CatalogueSnapshot; dir: 'ltr' | 'rtl' }

const longWord = 'Handwovenlinenandcottonworkshopcollective'
const longName = `The ${longWord} `.repeat(5).slice(0, 200)
const longText = Array.from({ length: 24 }, () => `${longWord} cloth, cut and finished slowly by hand.`).join(' ').slice(0, 2000)

/** The catalogue's words at their limits and its pictures gone (#1011), in the Shop API's own answer shapes. */
const stretched = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stretched)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, key === 'name' && typeof v === 'string' ? longName : key === 'description' && typeof v === 'string' ? longText : key === 'photos' ? [] : key === 'photo' || key === 'image' ? null : stretched(v)]),
  )
}

const stretchedCatalogue = (catalogue: CatalogueSnapshot['catalogue']) =>
  catalogue && { ...catalogue, answers: catalogue.answers.map((a) => ({ ...a, data: stretched(a.data) as Record<string, unknown> })) }

export const edgeCases = (s: CatalogueSnapshot): EdgeCase[] => [
  {
    name: 'very long names and no logo or contact details',
    snapshot: { ...s, store: { ...s.store, name: longName, description: longText, logo: null, contactEmail: null, contactPhone: null, address: null }, poweredBy: 'A partner with a very long brand name', catalogue: stretchedCatalogue(s.catalogue) },
    dir: 'ltr',
  },
  ...s.store.languages
    .filter((l) => l !== s.store.language)
    .map((language): EdgeCase => ({ name: `the ${language} language`, snapshot: { ...s, store: { ...s.store, language } }, dir: 'ltr' })),
  { name: 'a right-to-left layout', snapshot: s, dir: 'rtl' },
]
