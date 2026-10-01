import { z } from 'zod'
import { activityResults, actorKinds, datePresets } from '../../api/activity'
import { actionCodes, activityLevels } from '../../api/activityActions'
import { idParam, optionalParam } from './searchParams'

// What an IP filter may hold, so the field never sends what the URL would drop.
export const ipPattern = /^[0-9A-Fa-f.:]{1,45}$/

const utcDay = optionalParam(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))

// The three filters every Activity view has, so a tab's view is in its page's URL too (decided on #44).
export const activityTabSearch = {
  action: optionalParam(z.enum(actionCodes)),
  result: optionalParam(z.enum(activityResults)),
  date: optionalParam(z.enum(datePresets)),
  from: utcDay,
  to: utcDay,
  after: idParam,
  before: idParam,
}

// A view's filter is its search without the page it is on.
export const withoutCursors = <Search extends { after?: string | undefined; before?: string | undefined }>(search: Search): Omit<Search, 'after' | 'before'> => {
  const filter = { ...search }
  delete filter.after
  delete filter.before
  return filter
}

// The Activity log's filters (FIRST-RELEASE.md §9). `person` is an opaque id: typed text never reaches the URL.
export const activitySearch = {
  ...activityTabSearch,
  person: idParam,
  actor: optionalParam(z.enum(actorKinds)),
  level: optionalParam(z.enum(activityLevels)),
  partner: idParam,
  store: idParam,
  customer: idParam,
  target: optionalParam(z.string().regex(/^[a-z_]{1,20}:[A-Za-z0-9_-]{1,64}$/)),
  ip: optionalParam(z.string().regex(ipPattern)),
  imp: idParam,
  su: idParam,
}
