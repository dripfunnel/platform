import { loadCatalogueFacts, loadCollections, loadMarketCountries, type CollectionSummary } from '../../api/collections'
import { loadFilters, type Filter } from '../../api/filters'
import type { ApiClient } from '../../graphql'
import { seasonalFor, type SeasonKey } from './seasonal'

export type AreaFacts = { currency: string | null }

export type AreaData = { collections: CollectionSummary[]; filters: Filter[]; facts: AreaFacts; seasonal: SeasonKey[] }

/** What the Collections area reads at once. The seasonal ideas are a suggestion only: markets that don't load leave them out and nothing else. */
export const loadAreaData = async (client: ApiClient): Promise<AreaData> => {
  const [collections, filters, facts, countries] = await Promise.all([loadCollections(client), loadFilters(client), loadCatalogueFacts(client), loadMarketCountries(client).catch((): string[] => [])])
  return { collections, filters, facts: { currency: facts.pricingCurrency }, seasonal: seasonalFor(countries, new Date()) }
}
