import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadActivity, loadActivityPerson } from '../../api/activity'
import { loadMe } from '../../api/me'
import { ActivityLoading } from '../../features/activity/ActivityLog'
import { ActivityLogScreen, ActivityRouteError } from '../../features/activity/ActivityLogScreen'
import { activitySearch } from '../../features/common/activitySearch'
import { callerFor } from '../../features/common/harnessCaller'

export const Route = createFileRoute('/_app/activity')({
  validateSearch: z.object(activitySearch),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps: { after, before, ...filter }, location }) => {
    const me = await loadMe()
    const [page, person] = await Promise.all([
      loadActivity(filter, { after, before }, callerFor(me.role, location.searchStr)),
      filter.person ? loadActivityPerson(filter.person) : Promise.resolve(null),
    ])
    return { page, person }
  },
  pendingComponent: ActivityLoading,
  errorComponent: ActivityRouteError,
  component: ActivityLogScreen,
})
