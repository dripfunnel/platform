import type { CatalogueSettings } from '../../../api/settingsCatalogue'
import { inPlan, isKnownRule, sameSections, sectionsOf, toneOf, withPreset } from './catalogueView'

const settings: CatalogueSettings = {
  features: [
    { key: 'sizeCharts', enabled: true, inPlan: true },
    { key: 'specs', enabled: false, inPlan: true },
    { key: 'badges', enabled: true, inPlan: true },
    { key: 'aplus', enabled: true, inPlan: false },
    { key: 'video', enabled: false, inPlan: null },
  ],
  badges: [],
}

describe('the product page sections', () => {
  it('reads one the plan lacks as off, and one with no word from the API as in the plan', () => {
    expect(inPlan(settings, 'aplus')).toBe(false)
    expect(inPlan(settings, 'video')).toBe(true)
    expect(inPlan(settings, 'faqs')).toBe(true)
    expect(sectionsOf(settings)).toEqual({ sizeCharts: true, specs: false, highlights: false, faqs: false, badges: true, related: false, aplus: false, video: false })
  })

  it('switches a preset’s sections on and rules the others out, leaving the rest as they were', () => {
    const current = sectionsOf(settings)
    expect(withPreset(settings, current, 'electronics')).toEqual({ ...current, specs: true, highlights: true, faqs: true, related: true, sizeCharts: false })
  })

  it('never turns on a section the plan lacks', () => {
    const lacking: CatalogueSettings = { ...settings, features: [...settings.features, { key: 'faqs', enabled: false, inPlan: false }] }
    expect(withPreset(lacking, sectionsOf(lacking), 'electronics').faqs).toBe(false)
  })

  it('compares two settings section by section', () => {
    expect(sameSections(sectionsOf(settings), sectionsOf(settings))).toBe(true)
    expect(sameSections(sectionsOf(settings), { ...sectionsOf(settings), specs: true })).toBe(false)
  })
})

describe('badges', () => {
  it('colours a badge by what it says, and knows only the rules it has words for', () => {
    expect([toneOf('new_30_days'), toneOf('manual'), toneOf('few_left')]).toEqual(['ok', 'neutral', 'peach'])
    expect([isKnownRule('few_left'), isKnownRule('something_new')]).toEqual([true, false])
  })
})
