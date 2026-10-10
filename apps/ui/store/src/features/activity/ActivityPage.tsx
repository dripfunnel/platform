import { EmptyState, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { harnessEnabled, harnessSearch } from '../../harness'
import { messages } from '../../messages'
import { ActivityLog } from './ActivityLog'
import type { ActivitySearch } from './activitySearch'
import { activityRead, activityStates } from './activityStates'

const words = messages.activity
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/activity')

/** Store activity (StoreActivity), from the user menu: the whole store's log for whoever holds `activity.read` (ACCESS §5.1). */
export const ActivityPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const search = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(activityStates, harnessEnabled)
  const allowed = forced ? forced !== 'denied' : acting.permissions.includes('activity.read')
  const readOnly = forced ? forced === 'readOnly' : (state?.readOnly ?? false)
  const read = useMemo(() => activityRead(forced), [forced])
  const onSearch = useCallback(
    (next: ActivitySearch) => void navigate({ to: '/activity', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), ...next }), replace: true }),
    [navigate, forced],
  )

  if (!allowed) return <EmptyState title={words.denied.title} body={words.denied.body} />
  return (
    <>
      {readOnly && <p className="df-set-readonly">{words.readOnly}</p>}
      <ActivityLog
        title={acting.role === 'owner' ? words.title : words.managerTitle}
        heading="h1"
        search={search}
        onSearch={onSearch}
        read={read}
        canExport={forced ? acting.role === 'owner' : acting.permissions.includes('activity.export')}
        sample={Boolean(forced)}
      />
    </>
  )
}
