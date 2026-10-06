import { EmptyState } from '@dripfunnel/shared/ui'
import { getRouteApi } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { loadSupplierChoices } from '../../api/products'
import { messages } from '../../messages'
import { SupplierTabs } from '../products/SupplierTabs'
import { WarehousesView } from './WarehousesView'

const shellRoute = getRouteApi('/_app')

/** A supplier's Warehouses tab inside "Your products" (#337), or the merchant's locations with its suppliers' named. */
export const WarehousesPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const canEdit = !(state?.readOnly ?? false) && acting.permissions.includes('warehouses.write')
  const namesSuppliers = !acting.seller && acting.permissions.includes('manage-vendors')
  const [names, setNames] = useState<ReadonlyMap<string, string> | null>(null)
  useEffect(() => {
    if (!namesSuppliers) return
    let live = true
    loadSupplierChoices().then((all) => live && setNames(new Map(all.map((s) => [s.id, s.name]))), () => undefined)
    return () => {
      live = false
    }
  }, [namesSuppliers])
  return (
    <div className="df-places-page">
      <h1 className="df-page-title">{acting.seller ? messages.products.titleSupplier : messages.warehouses.tabs.warehouses}</h1>
      {acting.seller && <SupplierTabs current="warehouses" />}
      {acting.permissions.includes('stock.read') ? <WarehousesView canEdit={canEdit} side={acting.seller ? 'supplier' : 'merchant'} supplierNames={names} /> : <EmptyState title={messages.warehouses.denied.title} body={messages.warehouses.denied.body} />}
    </div>
  )
}
