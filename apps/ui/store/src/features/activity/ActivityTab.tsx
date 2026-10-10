import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { ActivityFilter, ActivityPage } from '../../api/activity'
import { harnessSearch } from '../../harness'
import { messages } from '../../messages'
import { ActivityLog } from './ActivityLog'
import type { ActivitySearch } from './activitySearch'

const settingsRoute = getRouteApi('/_app/settings')

export interface ActivityTabProps {
  read: (filter: ActivityFilter, after: string | null) => Promise<ActivityPage>
  /** The Owner holds `activity.export` (ACCESS §5.1); the API refuses anyone else. */
  canExport: boolean
  /** The harness's state, kept on the address as the filter changes; null outside it. */
  forced: string | null
}

/** Settings › Activity log: the Owner's view of the store's log, its filter kept in the address beside `?tab=`. */
export const ActivityTab = ({ read, canExport, forced }: ActivityTabProps) => {
  const { who, whoName, what, q } = settingsRoute.useSearch()
  const navigate = useNavigate()
  const onSearch = useCallback(
    (next: ActivitySearch) => void navigate({ to: '/settings', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), tab: 'activity', ...next }), replace: true }),
    [navigate, forced],
  )
  return <ActivityLog title={messages.activity.title} heading="h2" search={{ who, whoName, what, q }} onSearch={onSearch} read={read} canExport={canExport} sample={forced !== null} />
}
