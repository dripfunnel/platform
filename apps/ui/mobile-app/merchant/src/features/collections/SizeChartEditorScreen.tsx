import { loadCatalogueFacts } from '../../api/collections'
import { loadAccess } from '../../api/products'
import { loadSizeChart, loadSizeChartList, type SizeChart } from '../../api/sizeCharts'
import { ApiError, type ApiClient } from '../../graphql'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { stateOfError, useLoad } from '../products/useLoad'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { SizeChartForm } from './SizeChartForm'

export type SizeChartEditorData = {
  chart: SizeChart
  /** The store's own charts and the cap, for a copy; and whether the plan has charts at all. */
  own: number
  limit: number
  blocked: boolean
  access: { permissions: string[]; supplier: boolean }
}

const loadSizeChartEditor = async (client: ApiClient, id: string): Promise<SizeChartEditorData> => {
  const [access, chart, list, facts] = await Promise.all([loadAccess(client), loadSizeChart(client, id), loadSizeChartList(client), loadCatalogueFacts(client)])
  if (chart === null) throw new ApiError('NOT_FOUND', 'This size chart is not here.')
  return {
    chart,
    own: list.charts.filter((c) => c.supplierId === null).length,
    limit: list.limit,
    blocked: facts.features.find((f) => f.key === 'sizeCharts')?.inPlan === false,
    access,
  }
}

// Opens one size chart. A chart that isn't here, or that this seat can't read, is the shell's 404 or access-denied view (DESIGN.md §4).
export function SizeChartEditorScreen({ id }: { id: string }) {
  const client = sessionClient()
  const { state, reload } = useLoad(() => loadSizeChartEditor(client, id), [client, id])
  if (state.status === 'ready') return <SizeChartForm client={client} data={state.data} />
  return (
    <ShellScreen label={t('collections.charts.title')} onRetry={reload} {...(state.status === 'error' ? { state: stateOfError(state.error) } : {})}>
      <Skeleton />
    </ShellScreen>
  )
}
