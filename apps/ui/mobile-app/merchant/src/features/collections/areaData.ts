import { loadCatalogueFacts, loadCollections, loadMarketCountries, type CollectionSummary } from '../../api/collections'
import { loadFilters, type Filter } from '../../api/filters'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { seasonalFor, type SeasonKey } from './seasonal'

export type AreaFacts = {
  currency: string | null
  unit: 'cm' | 'in'
  /** Settings › Catalogue's switch and whether the plan has size charts. */
  sizeCharts: { enabled: boolean; inPlan: boolean | null }
}

export type AreaData = { collections: CollectionSummary[]; filters: Filter[]; facts: AreaFacts; seasonal: SeasonKey[] }

/** What the Collections area reads at once. The seasonal ideas are a suggestion only: markets that don't load leave them out and nothing else. */
export const loadAreaData = async (client: ApiClient): Promise<AreaData> => {
  const [collections, filters, facts, countries] = await Promise.all([loadCollections(client), loadFilters(client), loadCatalogueFacts(client), loadMarketCountries(client).catch((): string[] => [])])
  const charts = facts.features.find((feature) => feature.key === 'sizeCharts')
  return {
    collections,
    filters,
    facts: { currency: facts.pricingCurrency, unit: facts.unitSystem === 'imperial' ? 'in' : 'cm', sizeCharts: { enabled: charts?.enabled ?? false, inPlan: charts?.inPlan ?? null } },
    seasonal: seasonalFor(countries, new Date()),
  }
}
