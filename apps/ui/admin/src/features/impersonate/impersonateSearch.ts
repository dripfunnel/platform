import { z } from 'zod'
import { membershipRoles, sessionDates, sessionKinds, targetKinds, targetStatuses } from '../../api/impersonation'
import { idParam, optionalParam } from '@dripfunnel/shared/ui'

// Impersonate's filters. The search term is never one of them (FIRST-RELEASE.md §8).
export const usersSearch = {
  type: optionalParam(z.enum(targetKinds)),
  partner: idParam,
  store: idParam,
  role: optionalParam(z.enum(membershipRoles)),
  status: optionalParam(z.enum(targetStatuses)),
  after: idParam,
  before: idParam,
}

export const sessionsSearch = {
  kind: optionalParam(z.enum(sessionKinds)),
  staff: idParam,
  partner: idParam,
  store: idParam,
  date: optionalParam(z.enum(sessionDates)),
  after: idParam,
  before: idParam,
}
