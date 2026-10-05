import { isUuid } from '#core/ids'

// A product's listing sections and the store's size charts and badges before they are written
// (CATALOG-DESIGN R, S): pure, as rules.ts, so the API and imports share them.


export class ListingInvalid extends Error {
  constructor(readonly field: string) {
    super(`listing: ${field}`)
  }
}

const words = (value: string | null | undefined, max: number, field: string): string => {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '' || trimmed.length > max) throw new ListingInvalid(field)
  return trimmed
}

const optionalWords = (value: string | null | undefined, max: number, field: string): string | null => {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length > max) throw new ListingInvalid(field)
  return trimmed === '' ? null : trimmed
}

const ids = (values: readonly string[], max: number, field: string): string[] => {
  const clean = [...new Set(values.map((v) => v.toLowerCase()))]
  if (clean.length > max || !clean.every((v) => isUuid(v))) throw new ListingInvalid(field)
  return clean
}

export interface ListingInput {
  specs?: readonly { name: string; value: string; version?: number | null | undefined; filterValueId?: string | null | undefined }[] | null | undefined
  highlights?: readonly string[] | null | undefined
  faqs?: readonly { question: string; answer: string }[] | null | undefined
  relatedIds?: readonly string[] | null | undefined
  badgeIds?: readonly string[] | null | undefined
  ageRestricted?: boolean | null | undefined
  hazardous?: boolean | null | undefined
  compliance?: readonly { region: string; field: string; value: string }[] | null | undefined
  marketRule?: { mode: string; countries: readonly string[] } | null | undefined
}

export interface CleanListing {
  specs?: { name: string; value: string; version: number | null; filterValueId: string | null }[]
  highlights?: string[]
  faqs?: { question: string; answer: string }[]
  related?: string[]
  badgeIds?: string[]
  /** A flag left out keeps its saved value. */
  flags?: { ageRestricted: boolean | null; hazardous: boolean | null }
  compliance?: { region: string; field: string; value: string }[]
  marketRule?: { mode: 'only' | 'except'; countries: string[] } | null
}

const maxSpecs = 50
const maxHighlights = 5
const maxFaqs = 20
const maxRelated = 20
const maxProductBadges = 10
const maxCompliance = 50

const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
/** An ISO 3166-1 country the runtime can name; ZZ is CLDR's "Unknown Region", never a country. */
const isCountry = (code: string): boolean => /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && regions.of(code) !== undefined

/** Each section the input names, cleaned; one it leaves out stays as the product has it (S9). */
export const cleanListing = (input: ListingInput, versionCount: number, marketRuleGiven: boolean): CleanListing => {
  const out: CleanListing = {}
  if (input.specs) {
    if (input.specs.length > maxSpecs) throw new ListingInvalid('specs')
    out.specs = input.specs.map((s) => {
      const version = s.version ?? null
      if (version !== null && (!Number.isInteger(version) || version < 0 || version >= versionCount)) throw new ListingInvalid('specs')
      const filterValueId = s.filterValueId ?? null
      if (filterValueId !== null && !isUuid(filterValueId)) throw new ListingInvalid('specs')
      return { name: words(s.name, 60, 'specs'), value: words(s.value, 200, 'specs'), version, filterValueId: filterValueId?.toLowerCase() ?? null }
    })
  }
  if (input.highlights) {
    if (input.highlights.length > maxHighlights) throw new ListingInvalid('highlights')
    out.highlights = input.highlights.map((h) => words(h, 120, 'highlights'))
  }
  if (input.faqs) {
    if (input.faqs.length > maxFaqs) throw new ListingInvalid('faqs')
    out.faqs = input.faqs.map((f) => ({ question: words(f.question, 200, 'faqs'), answer: words(f.answer, 2000, 'faqs') }))
  }
  if (input.relatedIds) out.related = ids(input.relatedIds, maxRelated, 'related')
  if (input.badgeIds) out.badgeIds = ids(input.badgeIds, maxProductBadges, 'badges')
  if (input.ageRestricted != null || input.hazardous != null) out.flags = { ageRestricted: input.ageRestricted ?? null, hazardous: input.hazardous ?? null }
  if (input.compliance) {
    if (input.compliance.length > maxCompliance) throw new ListingInvalid('compliance')
    const seen = new Set<string>()
    out.compliance = input.compliance.map((c) => {
      const region = c.region.trim().toUpperCase()
      const field = c.field.trim()
      if (!/^([A-Z]{2}|EU|ALL)$/.test(region) || !/^[a-z][a-z0-9_]{1,40}$/.test(field) || seen.has(`${region}:${field}`)) throw new ListingInvalid('compliance')
      seen.add(`${region}:${field}`)
      return { region, field, value: words(c.value, 2000, 'compliance') }
    })
  }
  if (marketRuleGiven) {
    if (input.marketRule === null || input.marketRule === undefined) out.marketRule = null
    else {
      const { mode } = input.marketRule
      const list = [...new Set(input.marketRule.countries.map((c) => c.trim().toUpperCase()))]
      if ((mode !== 'only' && mode !== 'except') || list.length === 0 || !list.every(isCountry)) throw new ListingInvalid('marketRule')
      out.marketRule = { mode, countries: list }
    }
  }
  return out
}

export interface SizeChartInput {
  name: string
  unit: string
  systems?: readonly string[] | null | undefined
  measurements: readonly string[]
  rows: readonly { size: string; values: readonly string[] }[]
  howToMeasure?: readonly { measurement: string; text: string }[] | null | undefined
  fitNotes?: string | null | undefined
  modelInfo?: string | null | undefined
}

const maxChartColumns = 12
const maxChartRows = 60

/** A chart: sizes as rows, measurements as columns, a value (or range, "38–40") in every cell (R3–R5). */
export const cleanSizeChart = (input: SizeChartInput) => {
  const name = words(input.name, 80, 'name')
  const unit = (['cm', 'in'] as const).find((u) => u === input.unit)
  if (!unit) throw new ListingInvalid('unit')
  const systems = (input.systems ?? []).map((s) => words(s, 20, 'systems'))
  if (systems.length > 6) throw new ListingInvalid('systems')
  const measurements = input.measurements.map((m) => words(m, 40, 'measurements'))
  if (measurements.length === 0 || measurements.length > maxChartColumns || new Set(measurements.map((m) => m.toLowerCase())).size !== measurements.length) throw new ListingInvalid('measurements')
  if (input.rows.length === 0 || input.rows.length > maxChartRows) throw new ListingInvalid('rows')
  const rows = input.rows.map((r) => {
    if (r.values.length !== systems.length + measurements.length) throw new ListingInvalid('rows')
    return { size: words(r.size, 20, 'rows'), values: r.values.map((v) => words(v, 20, 'rows')) }
  })
  const howToMeasure = (input.howToMeasure ?? []).map((h) => {
    const measurement = words(h.measurement, 40, 'howToMeasure')
    if (!measurements.includes(measurement)) throw new ListingInvalid('howToMeasure')
    return { measurement, text: words(h.text, 300, 'howToMeasure') }
  })
  return { name, unit, systems, measurements, rows, howToMeasure, fitNotes: optionalWords(input.fitNotes, 500, 'fitNotes'), modelInfo: optionalWords(input.modelInfo, 200, 'modelInfo') }
}

const badgeTones = ['ok', 'peach', 'neutral'] as const
const badgeRules = ['new_30_days', 'top_5_this_month', 'below_compare_price', 'few_left', 'manual'] as const

/** S5: a label of up to 18 characters, a tone, and one rule. */
export const cleanBadge = (input: { label: string; tone: string; rule: string; position?: number | null | undefined }) => {
  const label = words(input.label, 18, 'label')
  const tone = badgeTones.find((t) => t === input.tone)
  const rule = badgeRules.find((r) => r === input.rule)
  const position = input.position ?? 0
  if (!tone || !rule || !Number.isInteger(position) || position < 0) throw new ListingInvalid('badge')
  return { label, tone, rule, position }
}
