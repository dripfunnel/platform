import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { startActivityExport, type ActivityFilter } from '../../api/activity'
import { withoutCursors } from '../common/activitySearch'
import { useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { ActivityError, ActivityLog } from './ActivityLog'
import { activityStates, forcedExport } from './activityHarness'
import { startExport, useExportJob } from '@dripfunnel/shared/ui'

const activityRoute = getRouteApi('/_app/activity')

export const ActivityLogScreen = () => {
  const { page, person } = activityRoute.useLoaderData()
  const filter: ActivityFilter = withoutCursors(activityRoute.useSearch())
  const forced = useScreenState(activityStates, harnessEnabled)
  const navigate = activityRoute.useNavigate()
  const router = useRouter()
  const job = useExportJob()

  // A new filter starts from the first page, so the cursors are dropped with the old one.
  const onFilterChange = useCallback((next: ActivityFilter) => void navigate({ search: next, replace: true }), [navigate])
  const onExport = () =>
    void startExport(startActivityExport(filter))

  return (
    <ActivityLog
      page={page}
      person={person}
      filter={filter}
      forced={forced}
      exportJob={forcedExport(forced) ?? job}
      onFilterChange={onFilterChange}
      onChoosePerson={(personId) => onFilterChange({ ...filter, person: personId })}
      onExport={() => void onExport()}
      onReload={() => void router.invalidate()}
    />
  )
}

export const ActivityRouteError = () => {
  const router = useRouter()
  return <ActivityError onRetry={() => void router.invalidate()} />
}
