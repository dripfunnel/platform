import { EmptyState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, Navigate } from '@tanstack/react-router'
import { useState } from 'react'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { SupplierTabs } from '../products/SupplierTabs'
import { collectionsStates, sampleChartReads } from './collectionsStates'
import { SizeChartsArea } from './SizeChartsArea'
import './collections.css'

const shellRoute = getRouteApi('/_app')

/** A supplier's Size charts tab inside "Your products": the charts it makes and keeps (decided on #337, R13). */
export const SupplierSizeChartsPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(collectionsStates, harnessEnabled)
  const [toast, setToast] = useState<string | null>(null)
  const canRead = forced ? forced !== 'denied' : acting.permissions.includes('catalog.read')
  const canEdit = forced ? forced !== 'staff' && forced !== 'readOnly' && forced !== 'denied' : acting.permissions.includes('catalog.write') && !(state?.readOnly ?? false)
  // A supplier's own tab: the merchant side keeps its charts under Collections, apart from its suppliers' (R13).
  if (!acting.seller && !forced) return <Navigate to="/collections" search={{ tab: 'sizeCharts' }} replace />
  return (
    <div className="df-charts-page">
      <h1 className="df-page-title">{messages.products.titleSupplier}</h1>
      <SupplierTabs current="sizeCharts" />
      {canRead ? <SizeChartsArea side="supplier" canEdit={canEdit} owner={false} onToast={setToast} reads={forced ? sampleChartReads(forced) : undefined} /> : <EmptyState title={messages.collections.charts.denied.title} body={messages.collections.charts.denied.body} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
