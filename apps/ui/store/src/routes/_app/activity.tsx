import { createFileRoute } from '@tanstack/react-router'
import { ActivityPage } from '../../features/activity/ActivityPage'
import { activitySearch } from '../../features/activity/activitySearch'

export const Route = createFileRoute('/_app/activity')({
  validateSearch: activitySearch,
  component: ActivityPage,
})
