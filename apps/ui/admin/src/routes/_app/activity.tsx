import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadActivity, loadActivityPerson } from '../../api/activity'
import { ActivityLoading } from '../../features/activity/ActivityLog'
import { ActivityLogScreen, ActivityRouteError } from '../../features/activity/ActivityLogScreen'
import { activitySearch } from '../../features/common/activitySearch'

export const Route = createFileRoute('/_app/activity')({
  validateSearch: z.object(activitySearch),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps: { after, before, ...filter } }) => {
    const [page, person] = await Promise.all([
      loadActivity(filter, { after, before }),
      filter.person ? loadActivityPerson(filter.person) : Promise.resolve(null),
    ])
    return { page, person }
  },
  pendingComponent: ActivityLoading,
  errorComponent: ActivityRouteError,
  component: ActivityLogScreen,
})
