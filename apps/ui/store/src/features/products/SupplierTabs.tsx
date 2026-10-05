import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import './supplierTabs.css'

const words = messages.warehouses.tabs

/** "Your products" for a supplier: its products, and the locations it counts stock in (#337). */
export const SupplierTabs = ({ current }: { current: 'products' | 'warehouses' }) => (
  <nav className="df-supplier-tabs" aria-label={words.label}>
    <Link to="/products" activeOptions={{ exact: true }} aria-current={current === 'products' ? 'page' : undefined}>
      {words.products}
    </Link>
    <Link to="/products/warehouses" aria-current={current === 'warehouses' ? 'page' : undefined}>
      {words.warehouses}
    </Link>
  </nav>
)
