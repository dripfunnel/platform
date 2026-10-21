import { badgeRules, sectionKeys, type BadgeRule, type CatalogueSettings, type SectionKey } from '../../../api/settingsCatalogue'

export type Sections = Record<SectionKey, boolean>

/** "What do you mostly sell?": the sections each kind of shop usually wants (CatSettings' presets). */
export const presets = {
  clothing: { sizeCharts: true, specs: true, highlights: true, badges: true },
  electronics: { specs: true, highlights: true, faqs: true, related: true, sizeCharts: false },
  food: { highlights: true, faqs: true, sizeCharts: false, specs: true },
  beauty: { highlights: true, faqs: true, sizeCharts: false },
  handmade: { badges: true, highlights: true, sizeCharts: false },
} as const satisfies Record<string, Partial<Sections>>
export type PresetKey = keyof typeof presets
export const presetKeys = Object.keys(presets) as PresetKey[]

export const inPlan = (settings: CatalogueSettings, key: SectionKey): boolean => settings.features.find((feature) => feature.key === key)?.inPlan !== false

/** A section the plan no longer has reads as off, as the server treats it: a save never sends it on. */
export const sectionsOf = (settings: CatalogueSettings): Sections =>
  Object.fromEntries(sectionKeys.map((key) => [key, (settings.features.find((feature) => feature.key === key)?.enabled ?? false) && inPlan(settings, key)])) as Sections

/** A preset switches on what it names and off what it rules out, and leaves the rest as they are; a section the plan lacks stays off. */
export const withPreset = (settings: CatalogueSettings, current: Sections, preset: PresetKey): Sections => {
  const wanted: Partial<Sections> = presets[preset]
  return Object.fromEntries(sectionKeys.map((key) => [key, (wanted[key] ?? current[key]) && inPlan(settings, key)])) as Sections
}

/** A badge's colour follows what it says, as in the prototype; the API holds three. */
export const toneOf = (rule: BadgeRule): 'ok' | 'peach' | 'neutral' => (rule === 'new_30_days' ? 'ok' : rule === 'manual' ? 'neutral' : 'peach')

export const isKnownRule = (rule: string): rule is BadgeRule => (badgeRules as readonly string[]).includes(rule)

export const sameSections = (a: Sections, b: Sections): boolean => sectionKeys.every((key) => a[key] === b[key])
