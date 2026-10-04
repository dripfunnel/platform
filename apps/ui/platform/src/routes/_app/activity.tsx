import { idParam, optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { activityResults, activityWhos, datePresets, loadActivity, loadPersonTimeline } from '../../api/activity'
import { loadStoreName, loadStores } from '../../api/stores'
import { ActivityLoading } from '../../features/activity/ActivityLog'
import { ActivityRouteError, ActivityScreen } from '../../features/activity/ActivityScreen'

// FIRST-RELEASE §13's chips, all in the URL; `person` is the API's reference, never typed text.
const activitySearch = z.looseObject({
  who: optionalParam(z.enum(activityWhos)),
  action: optionalParam(z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/).max(100)),
  result: optionalParam(z.enum(activityResults)),
  storeId: idParam,
  date: optionalParam(z.enum(datePresets)),
  person: optionalParam(z.string().regex(/^(team|owner):[0-9a-f-]{36}$/)),
})

export const Route = createFileRoute('/_app/activity')({
  validateSearch: activitySearch,
  loaderDeps: ({ search: { who, action, result, storeId, date, person } }) => ({ who, action, result, storeId, date, person }),
  loader: async ({ deps: { person, ...filter } }) => {
    // The Store filter's names: the newest page of stores, and the one the filter names when it is older.
    const [page, stores, chosen] = await Promise.all([
      person ? loadPersonTimeline(person, filter, {}) : loadActivity(filter, {}),
      loadStores({}, {}).then(
        (list) => list.items.map((store) => ({ id: store.id, name: store.name })),
        () => [],
      ),
      filter.storeId ? loadStoreName(filter.storeId) : Promise.resolve(null),
    ])
    return { page, stores: chosen && !stores.some((store) => store.id === chosen.id) ? [chosen, ...stores] : stores }
  },
  pendingComponent: ActivityLoading,
  errorComponent: ActivityRouteError,
  component: ActivityScreen,
})
