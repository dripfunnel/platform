import type { Market } from '../../../api/settingsMarkets'
import type { StoreLocale } from '../../../api/settingsStore'
import { blankMarket, draftOfMarket, isMarketDirty, marketInputOf, marketProblem, nested, takenBy, type MarketDraft, type MarketProblem } from './marketDraft'

const market = (over: Partial<Market> & Pick<Market, 'id' | 'name' | 'countries' | 'currency'>): Market => ({
  parentId: null,
  primary: false,
  everywhereElse: false,
  active: true,
  language: 'en-IN',
  priceAdjustmentBps: 0,
  webMode: 'main',
  pathPrefix: null,
  products: 'all',
  excludedProductIds: [],
  excludedProducts: [],
  duties: { mode: 'none', rateBps: null, thresholdAmount: null },
  revision: 3,
  ...over,
})

const us = market({
  id: 'mk-us',
  name: 'United States',
  countries: ['US'],
  currency: 'USD',
  language: 'en-US',
  priceAdjustmentBps: 1050,
  webMode: 'path',
  pathPrefix: 'us',
  products: 'some',
  excludedProductIds: ['p1', 'p2'],
  excludedProducts: [{ id: 'p1', name: 'Mara Linen Shirt' }],
  duties: { mode: 'flat', rateBps: 1200, thresholdAmount: '80000' },
})

describe('a market as the editor holds it', () => {
  it('shows the adjustment, the duty rate and the threshold in the units a person types', () => {
    expect(draftOfMarket(us)).toMatchObject({ adjust: '10.5', dutyRate: '12', dutyThreshold: '800.00', pathPrefix: 'us', revision: 3 })
  })

  it('keeps a product deleted since, named as such, and leaves it out of the save', () => {
    const draft = draftOfMarket(us)
    expect(draft.excluded).toEqual([
      { id: 'p1', name: 'Mara Linen Shirt' },
      { id: 'p2', name: 'A product deleted since — dropped when you save', gone: true },
    ])
    expect(marketInputOf(draft).excludedProductIds).toEqual(['p1'])
  })

  it('goes back to the API in basis points and minor units', () => {
    expect(marketInputOf(draftOfMarket(us))).toEqual({
      name: 'United States',
      parentId: null,
      active: true,
      countries: ['US'],
      currency: 'USD',
      language: 'en-US',
      priceAdjustmentBps: 1050,
      webMode: 'path',
      pathPrefix: 'us',
      products: 'some',
      excludedProductIds: ['p1'],
      dutiesMode: 'flat',
      dutiesRateBps: 1200,
      dutiesThresholdAmount: '80000',
    })
  })

  it('sends no path for the main address, no exclusions for all products and no duty figures for none', () => {
    const sent = marketInputOf({ ...draftOfMarket(us), webMode: 'main', products: 'all', duties: 'none' })
    expect(sent).toMatchObject({ pathPrefix: null, excludedProductIds: [], dutiesMode: 'none', dutiesRateBps: null, dutiesThresholdAmount: null })
  })

  it('reads a comma as the decimal point in the adjustment and the duty rate, as it does in the tax rate', () => {
    const sent = marketInputOf({ ...draftOfMarket(us), adjust: '-7,5', dutyRate: '7,5' })
    expect([sent.priceAdjustmentBps, sent.dutiesRateBps]).toEqual([-750, 750])
  })

  it('keeps the primary market on, whatever the switch says', () => {
    expect(marketInputOf({ ...draftOfMarket(us), primary: true, active: false }).active).toBe(true)
  })

  it('starts a new one from the main currency and language with no countries', () => {
    const loc: StoreLocale = { pricingCurrency: 'INR', mainLanguage: 'en-IN', offeredLanguages: [], currencies: [], languages: [], examples: [] }
    expect(blankMarket('UK', loc)).toMatchObject({ id: null, revision: null, name: 'UK', currency: 'INR', language: 'en-IN', countries: [], active: true })
  })

  it('is dirty only once changed', () => {
    const start = draftOfMarket(us)
    expect(isMarketDirty(start, start)).toBe(false)
    expect(isMarketDirty({ ...start, adjust: '11' }, start)).toBe(true)
  })
})

describe('what can’t be saved yet', () => {
  const draft = draftOfMarket(us)

  it.each<[Partial<MarketDraft>, MarketProblem]>([
    [{ name: ' ' }, 'name'],
    [{ countries: [] }, 'countries'],
    [{ adjust: '1.234' }, 'adjust'],
    [{ pathPrefix: 'Not Ok' }, 'path'],
    [{ dutyRate: '' }, 'dutyRate'],
    [{ dutyRate: '1000' }, 'dutyRate'],
    [{ dutyThreshold: '1,000.00' }, 'dutyThreshold'],
  ])('%j is %s', (change, expected) => {
    expect(marketProblem({ ...draft, ...change })).toBe(expected)
  })

  it('accepts the market as it is, and a negative adjustment', () => {
    expect(marketProblem(draft)).toBeNull()
    expect(marketProblem({ ...draft, adjust: '-5' })).toBeNull()
  })

  it('says a sub-market may sell only in its parent’s countries', () => {
    expect(marketProblem({ ...draft, countries: ['US', 'CA'] }, ['US'])).toBe('parentCountries')
    expect(marketProblem(draft, ['US'])).toBeNull()
  })
})

describe('countries and nesting', () => {
  const india = market({ id: 'mk-in', name: 'India', countries: ['IN'], currency: 'INR', primary: true })
  const sub = market({ id: 'mk-ny', name: 'New York', countries: ['US'], currency: 'USD', parentId: 'mk-us' })

  it('names the market that already holds a country, but not the market’s own, its sub-markets’ or its parent’s', () => {
    expect([...takenBy([india, us, sub], draftOfMarket(us))]).toEqual([['IN', 'India']])
  })

  it('lists each top-level market with its sub-markets under it', () => {
    expect(nested([sub, india, us]).map((m) => m.id)).toEqual(['mk-in', 'mk-us', 'mk-ny'])
  })
})
