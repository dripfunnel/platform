import { loadAccess, loadCatalogueBasics, loadProduct } from '../../../api/products'
import { loadProductStory, loadStoryBlocks, type ProductStory } from '../../../api/productStory'
import { ApiError, type ApiClient } from '../../../graphql'

export type StoryData = {
  productId: string
  productName: string
  story: ProductStory
  /** The store's brand stories; none for a supplier, which has none, and null when they could not be read. */
  blocks: { id: string; name: string }[] | null
  /** Whether the plan has product video, and whether the store has the section on. */
  video: 'on' | 'off' | 'plan'
  /** Whether the plan has A+ content at all. */
  available: boolean
  access: { permissions: string[]; supplier: boolean }
}

/** What the A+ screen opens with. A product that isn't here, or isn't the caller's, is a `NOT_FOUND` (ACCESS.md §11). */
export const loadStory = async (client: ApiClient, productId: string): Promise<StoryData> => {
  const [product, story, access, basics] = await Promise.all([loadProduct(client, productId), loadProductStory(client, productId), loadAccess(client), loadCatalogueBasics(client)])
  if (!product || !story) throw new ApiError('NOT_FOUND', 'No such product.')
  const blocks = access.supplier ? [] : await loadStoryBlocks(client).catch(() => null)
  const video = basics.features.find((feature) => feature.key === 'video')
  const aplus = basics.features.find((feature) => feature.key === 'aplus')
  return {
    productId: product.id,
    productName: product.name,
    story,
    blocks,
    video: !video?.enabled ? 'off' : video.inPlan === false ? 'plan' : 'on',
    available: aplus?.enabled === true && aplus.inPlan !== false,
    access,
  }
}
