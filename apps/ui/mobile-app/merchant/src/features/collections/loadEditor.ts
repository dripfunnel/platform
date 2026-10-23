import { loadCatalogueFacts, loadCollection, loadCollections, loadMembers, type Collection, type CollectionSummary, type Member } from '../../api/collections'
import { loadFilters, type Filter } from '../../api/filters'
import { loadMenu } from '../../api/menu'
import { loadAccess } from '../../api/products'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

export type CollectionEditorData = {
  /** Null for a new collection. */
  collection: Collection | null
  members: Member[]
  /** Whether its menu has it: null when the menu didn't load, so the sentence says "if". */
  inMenu: boolean | null
  filters: Filter[]
  collections: CollectionSummary[]
  currency: string | null
  access: { permissions: string[]; supplier: boolean }
}

/** Everything the editor opens with. A collection that isn't here is a NOT_FOUND, which the screen draws as its 404. */
export const loadCollectionEditor = async (client: ApiClient, id: string | null): Promise<CollectionEditorData> => {
  const [access, filters, collections, facts, collection] = await Promise.all([
    loadAccess(client),
    loadFilters(client),
    loadCollections(client),
    loadCatalogueFacts(client),
    id === null ? Promise.resolve(null) : loadCollection(client, id),
  ])
  if (id !== null && collection === null) throw new ApiError('NOT_FOUND', 'This collection is not here.')
  const [members, inMenu] = await Promise.all([
    collection?.kind === 'manual' ? loadMembers(client, collection.id) : Promise.resolve([]),
    collection === null ? Promise.resolve(false) : loadMenu(client).then((menu) => (menu?.items ?? []).some((item) => item.collectionId === collection.id), () => null),
  ])
  return { collection, members, inMenu, filters, collections, currency: facts.pricingCurrency, access }
}
