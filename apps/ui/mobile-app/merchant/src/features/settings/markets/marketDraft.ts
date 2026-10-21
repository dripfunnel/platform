import type { Market, MarketInput } from '../../../api/settingsMarkets'
import type { StoreLocale } from '../../../api/settingsStore'
import { minorOf, moneyText } from '../../../format'
import { t } from '../../../messages'
import { bpsOf } from '../percent'

/** A market as the editor holds it: numbers and money as typed, until saved. */
export type MarketDraft = {
  id: string | null
  revision: number | null
  name: string
  parentId: string | null
  primary: boolean
  active: boolean
  countries: string[]
  currency: string
  language: string
  adjust: string
  webMode: 'main' | 'path'
  pathPrefix: string
  products: 'all' | 'some'
  /** `gone`: deleted since, shown so the merchant knows, and left out of the save (the API refuses an id it can't find). */
  excluded: { id: string; name: string; gone?: boolean }[]
  duties: 'none' | 'by_code' | 'flat'
  dutyRate: string
  dutyThreshold: string
}

export const draftOfMarket = (market: Market): MarketDraft => ({
  id: market.id,
  revision: market.revision,
  name: market.name,
  parentId: market.parentId,
  primary: market.primary,
  active: market.active,
  countries: [...market.countries],
  currency: market.currency,
  language: market.language,
  adjust: market.priceAdjustmentBps === 0 ? '' : String(market.priceAdjustmentBps / 100),
  webMode: market.webMode,
  pathPrefix: market.pathPrefix ?? '',
  products: market.products,
  // An id the API no longer names was a product deleted since: shown as such, and dropped by the save.
  excluded: market.excludedProductIds.map((id) => {
    const named = market.excludedProducts.find((product) => product.id === id)
    return named ? { id, name: named.name } : { id, name: t('settings.markets.deletedProduct'), gone: true }
  }),
  duties: market.duties.mode,
  dutyRate: market.duties.rateBps === null ? '' : String(market.duties.rateBps / 100),
  dutyThreshold: market.duties.thresholdAmount ? moneyText({ amount: market.duties.thresholdAmount, currency: market.currency }) : '',
})

/** A market not made yet: the main currency and language to start from, no countries until they are picked. */
export const blankMarket = (name: string, loc: StoreLocale): MarketDraft => ({
  id: null,
  revision: null,
  name,
  parentId: null,
  primary: false,
  active: true,
  countries: [],
  currency: loc.pricingCurrency ?? loc.currencies[0]?.code ?? '',
  language: loc.mainLanguage ?? loc.languages[0]?.code ?? '',
  adjust: '',
  webMode: 'main',
  pathPrefix: '',
  products: 'all',
  excluded: [],
  duties: 'none',
  dutyRate: '',
  dutyThreshold: '',
})

export const isMarketDirty = (draft: MarketDraft, start: MarketDraft): boolean => JSON.stringify(draft) !== JSON.stringify(start)

// The API's own limits (markets/rules.ts): an adjustment from -90% to +1,000%, and a flat duty rate above 0 up to 100%.
const adjustmentOf = (text: string): number | null => {
  const bps = bpsOf(text, true)
  return bps !== null && bps >= -9000 && bps <= 100000 ? bps : null
}
const dutyRateOf = (text: string): number | null => {
  const bps = bpsOf(text)
  return bps !== null && bps >= 1 ? bps : null
}

export type MarketProblem = 'name' | 'countries' | 'adjust' | 'path' | 'dutyRate' | 'dutyThreshold' | 'parentCountries'

/** What can't be saved yet, said before the API would refuse it; a sub-market sells in its parent's countries only. */
export const marketProblem = (draft: MarketDraft, parentCountries: readonly string[] | null = null): MarketProblem | null => {
  if (draft.name.trim() === '') return 'name'
  if (draft.countries.length === 0) return 'countries'
  if (parentCountries && draft.countries.some((country) => !parentCountries.includes(country))) return 'parentCountries'
  if (draft.adjust.trim() !== '' && adjustmentOf(draft.adjust) === null) return 'adjust'
  if (draft.webMode === 'path' && !/^[a-z0-9][a-z0-9-]{0,19}$/.test(draft.pathPrefix.trim())) return 'path'
  if (draft.duties === 'flat' && dutyRateOf(draft.dutyRate) === null) return 'dutyRate'
  if (draft.duties !== 'none' && draft.dutyThreshold.trim() !== '' && minorOf(draft.dutyThreshold, draft.currency) === 'invalid') return 'dutyThreshold'
  return null
}

/** The draft as the API takes it. Money is minor units as a digit string; the adjustment and the duty rate are basis points. */
export const marketInputOf = (draft: MarketDraft): MarketInput => {
  const threshold = draft.duties !== 'none' && draft.dutyThreshold.trim() !== '' ? minorOf(draft.dutyThreshold, draft.currency) : null
  return {
    name: draft.name.trim(),
    parentId: draft.parentId,
    active: draft.primary || draft.active,
    countries: draft.countries,
    currency: draft.currency,
    language: draft.language,
    priceAdjustmentBps: draft.adjust.trim() === '' ? 0 : (adjustmentOf(draft.adjust) ?? 0),
    webMode: draft.webMode,
    pathPrefix: draft.webMode === 'path' ? draft.pathPrefix.trim() : null,
    products: draft.products,
    excludedProductIds: draft.products === 'some' ? draft.excluded.filter((product) => !product.gone).map((product) => product.id) : [],
    dutiesMode: draft.duties,
    dutiesRateBps: draft.duties === 'flat' ? dutyRateOf(draft.dutyRate) : null,
    dutiesThresholdAmount: typeof threshold === 'string' ? threshold : null,
  }
}

/** Top-level markets with their sub-markets under each. */
export const nested = (markets: readonly Market[]): Market[] => markets.filter((market) => market.parentId === null).flatMap((top) => [top, ...markets.filter((market) => market.parentId === top.id)])

// A market not saved yet has no id, so nothing is its sub-market and a top-level market (parentId null) is not its parent.
const related = (market: Market, draft: MarketDraft): boolean =>
  market.id === draft.id || (draft.id !== null && market.parentId === draft.id) || (draft.parentId !== null && market.id === draft.parentId)

/** Each country another market already holds (a market, its sub-markets and its parent don't count as another), with that market's name. */
export const takenBy = (markets: readonly Market[], draft: MarketDraft): Map<string, string> =>
  new Map(markets.filter((market) => !related(market, draft)).flatMap((market) => market.countries.map((country) => [country, market.name] as const)))
