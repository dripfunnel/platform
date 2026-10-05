import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useState } from 'react'
import { loadProductBasics } from '../../api/productEditor'
import { loadSizeChartList, type SizeChart, type SizeChartSummary } from '../../api/sizeCharts'
import { messages } from '../../messages'
import { SizeChartsTab } from './SizeChartsTab'

const words = messages.collections.charts

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; charts: SizeChartSummary[]; limit: number; feature: { enabled: boolean; inPlan: boolean | null }; unit: 'cm' | 'in'; india: boolean }

/** What the area reads: the API, or the ?state= harness's samples. */
export interface ChartReads {
  list: () => Promise<{ charts: SizeChartSummary[]; limit: number; feature: { enabled: boolean; inPlan: boolean | null }; unit: 'cm' | 'in'; india: boolean }>
  chart?: (id: string) => Promise<SizeChart | null>
}

const apiList: ChartReads['list'] = async () => {
  const [{ charts, limit }, basics] = await Promise.all([loadSizeChartList(), loadProductBasics()])
  const f = basics.features.find((x) => x.key === 'sizeCharts')
  return { charts, limit, feature: { enabled: f?.enabled ?? false, inPlan: f?.inPlan ?? null }, unit: basics.unitSystem === 'imperial' ? 'in' : 'cm', india: basics.pricingCurrency === 'INR' }
}

export interface SizeChartsAreaProps {
  /** The merchant side keeps the store's charts here; a supplier's are its own (R13). */
  side: 'merchant' | 'supplier'
  canEdit: boolean
  owner: boolean
  onToast: (text: string) => void
  reads?: ChartReads | undefined
}

/** Size charts, loaded for either side: the merchant's Collections tab and a supplier's "Your products" tab. */
export const SizeChartsArea = ({ side, canEdit, owner, onToast, reads }: SizeChartsAreaProps) => {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const list = reads?.list ?? apiList
  const load = useCallback(() => {
    setView({ kind: 'loading' })
    void list().then(
      (r) => setView({ kind: 'ready', ...r, charts: side === 'merchant' ? r.charts.filter((c) => c.supplierId === null) : r.charts }),
      () => setView({ kind: 'error' }),
    )
  }, [list, side])
  useEffect(load, [load])

  if (view.kind === 'loading') return <LoadingState label={words.loading} />
  if (view.kind === 'error') return <ErrorState title={words.loadFailed.title} body={words.loadFailed.body} retry={{ label: words.retry, onRetry: load }} />
  return (
    <SizeChartsTab
      charts={view.charts}
      limit={view.limit}
      canEdit={canEdit}
      feature={view.feature}
      owner={owner}
      unit={view.unit}
      india={view.india}
      onToast={onToast}
      onSaved={(text) => {
        onToast(text)
        // The editor keeps what was saved; a list that didn't refresh says so rather than going quietly stale.
        void list().then(
          (r) => setView((v) => (v.kind === 'ready' ? { ...v, charts: side === 'merchant' ? r.charts.filter((c) => c.supplierId === null) : r.charts } : v)),
          () => onToast(words.loadFailed.title),
        )
      }}
      {...(reads?.chart ? { read: reads.chart } : {})}
    />
  )
}
