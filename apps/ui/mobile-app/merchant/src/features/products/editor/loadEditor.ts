import { loadProductStock, loadWarehouses, type StockLevel, type Warehouse } from '../../../api/inventory'
import { ApiError, type ApiClient } from '../../../graphql'
import { loadProductKind, type ProductKindView } from '../../../api/productKinds'
import { loadSizeChartList } from '../../../api/sizeCharts'
import { loadAccess, loadApprovalRequired, loadCatalogueBasics, loadProduct, type EditorProduct } from '../../../api/products'

export type EditorData = {
  /** Null for a new product. */
  product: EditorProduct | null
  currency: string
  access: { permissions: string[]; supplier: boolean }
  approvalRequired: boolean
  warehouses: Warehouse[]
  levels: Map<string, StockLevel[]>
  /** What a download, a service or a gift card holds (a merchant seat's: a supplier sells physical items only); null for a physical item and a new product. */
  kind: ProductKindView | null
  /** Whether the plan has A+ content (`plan` says it hasn't); null when the store has the section off. */
  aplus: 'on' | 'plan' | null
  /** The store's size charts to pick from: null when the store has the section off or the seat is a supplier's, `failed` when they didn't load. */
  sizeCharts: { id: string; name: string }[] | 'failed' | null
}

/** What the editor opens with. A product that isn't here, or isn't the caller's, is a `NOT_FOUND` (ACCESS.md §11). */
export const loadEditor = async (client: ApiClient, productId: string | null): Promise<EditorData> => {
  const [product, basics, access, approvalRequired] = await Promise.all([productId ? loadProduct(client, productId) : Promise.resolve(null), loadCatalogueBasics(client), loadAccess(client), loadApprovalRequired(client)])
  if (productId && !product) throw new ApiError('NOT_FOUND', 'No such product.')
  const currency = product?.pricingCurrency ?? basics.pricingCurrency
  if (!currency) throw new ApiError('CURRENCY_REQUIRED', 'The store has no pricing currency yet.')
  const kind = product && product.productType !== 'physical' && !access.supplier ? await loadProductKind(client, product.id) : null
  const [warehouses, levels] = await Promise.all([loadWarehouses(client, access.supplier), productId ? loadProductStock(client, productId) : Promise.resolve(new Map<string, StockLevel[]>())])
  const aplus = basics.features.find((feature) => feature.key === 'aplus')
  const charts = basics.features.find((feature) => feature.key === 'sizeCharts')
  const sizeCharts = !charts?.enabled || access.supplier ? null : await loadSizeChartList(client).then(({ charts: list }) => list.map(({ id, name }) => ({ id, name })), () => 'failed' as const)
  return { product, currency, access, approvalRequired, warehouses, levels, kind, sizeCharts, aplus: !aplus?.enabled ? null : aplus.inPlan === false ? 'plan' : 'on' }
}
