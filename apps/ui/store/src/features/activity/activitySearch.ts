import { optionalParam, searchParam } from '@dripfunnel/shared/search'
import { z } from 'zod'
import { activityWhats } from '../../api/activity'

/** The log's filter in the address, so a reload or a shared link keeps it (StoreActivity's Person, What and Search). */
export const activitySearchShape = {
  // kind:id, as the API filters a person (apps/api/src/saas/storeActivity).
  who: optionalParam(z.string().regex(/^[a-z_]{1,32}:[^\s]{1,200}$/)),
  what: optionalParam(z.enum(activityWhats)),
  q: searchParam,
}

export const activitySearch = z.looseObject(activitySearchShape)
export type ActivitySearch = { who?: string | undefined; what?: (typeof activityWhats)[number] | undefined; q?: string | undefined }
