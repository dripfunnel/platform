import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import './supplierTabs.css'

const words = messages.warehouses.tabs

/** "Your products" for a supplier: its products, the locations it counts stock in (#337), and its own size charts (R13). */
export const SupplierTabs = ({ current }: { current: 'products' | 'warehouses' | 'sizeCharts' }) => (
  <nav className="df-supplier-tabs" aria-label={words.label}>
    <Link to="/products" activeOptions={{ exact: true }} aria-current={current === 'products' ? 'page' : undefined}>
      {words.products}
    </Link>
    <Link to="/products/warehouses" aria-current={current === 'warehouses' ? 'page' : undefined}>
      {words.warehouses}
    </Link>
    <Link to="/products/size-charts" aria-current={current === 'sizeCharts' ? 'page' : undefined}>
      {words.sizeCharts}
    </Link>
  </nav>
)
