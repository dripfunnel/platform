import { z } from 'zod'
import { customerStatuses, customerWindows, signInMethods } from '../../api/customers'
import { idParam, optionalParam } from '@dripfunnel/shared/ui'

// The filters in the URL, on Customers and on a store's Customers tab. The search term is
// never one of them (decided on #42). `status`, not `state`: ?state= is the designed-states
// harness (docs/ui/README.md §6).
export const customerFilterSearch = {
  status: optionalParam(z.enum(customerStatuses)),
  via: optionalParam(z.enum(signInMethods)),
  created: optionalParam(z.enum(customerWindows)),
  lastSignIn: optionalParam(z.enum(customerWindows)),
  after: idParam,
  before: idParam,
}
