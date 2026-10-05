import { EmptyState } from '@dripfunnel/shared/ui'
import { getRouteApi } from '@tanstack/react-router'
import { messages } from '../../messages'
import { SupplierTabs } from '../products/SupplierTabs'
import { WarehousesView } from './WarehousesView'

const shellRoute = getRouteApi('/_app')

/** A supplier's Warehouses tab inside "Your products" (#337): the locations it adds and counts its stock in. */
export const WarehousesPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const canEdit = !(state?.readOnly ?? false) && acting.permissions.includes('warehouses.write')
  return (
    <div className="df-places-page">
      <h1 className="df-page-title">{acting.seller ? messages.products.titleSupplier : messages.warehouses.tabs.warehouses}</h1>
      {acting.seller && <SupplierTabs current="warehouses" />}
      {acting.permissions.includes('stock.read') ? <WarehousesView canEdit={canEdit} /> : <EmptyState title={messages.warehouses.denied.title} body={messages.warehouses.denied.body} />}
    </div>
  )
}
