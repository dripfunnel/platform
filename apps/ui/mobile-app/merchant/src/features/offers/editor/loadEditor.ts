import type { CollectionSummary } from '../../../api/collections'
import { loadCollections } from '../../../api/collections'
import { loadCustomerGroups, type CustomerGroup } from '../../../api/customers'
import { loadFilters, type Filter } from '../../../api/filters'
import { loadCustomerNames, loadOffer, loadOfferFacts, loadProductNames, type Offer, type OfferIdNames } from '../../../api/offers'
import { loadMarkets, type Market } from '../../../api/settingsMarkets'
import { ApiError, type ApiClient } from '../../../graphql'
import { draftOf, type StoreFacts } from '../offerDraft'

export type OfferEditorData = {
  /** Null for a new offer. */
  offer: Offer | null
  facts: StoreFacts
  filters: Filter[]
  collections: CollectionSummary[]
  groups: CustomerGroup[]
  markets: Market[]
  productNames: OfferIdNames
  customerNames: OfferIdNames
}

/**
 * Everything the editor opens with. An offer that isn't here is a NOT_FOUND, which the screen draws as its 404. The names of the products
 * and customers an offer names are read too, since unnamed chips could be saved over unseen: if they can't be read, the editor doesn't open.
 */
export const loadOfferEditor = async (client: ApiClient, id: string | null): Promise<OfferEditorData> => {
  const [facts, filters, collections, groups, markets, offer] = await Promise.all([
    loadOfferFacts(client),
    loadFilters(client),
    loadCollections(client),
    loadCustomerGroups(client),
    // Markets only offer "shoppers in one market"; a seat that can't read them still edits everything else.
    loadMarkets(client).catch((): Market[] => []),
    id === null ? Promise.resolve(null) : loadOffer(client, id),
  ])
  if (id !== null && offer === null) throw new ApiError('NOT_FOUND', 'This offer is not here.')
  const draft = offer ? draftOf(offer, facts) : null
  const [productNames, customerNames] = await Promise.all([
    loadProductNames(client, [...new Set([...(draft?.productIds ?? []), ...(draft?.buyIds ?? []), ...(draft?.getIds ?? [])])]),
    loadCustomerNames(client, draft?.customerIds ?? []),
  ])
  return { offer, facts, filters, collections, groups, markets, productNames, customerNames }
}
