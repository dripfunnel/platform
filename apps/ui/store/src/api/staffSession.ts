import { adminConsoleUrlFor, createPortalSession } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../harness'

export { harnessEnabled } from '../harness'

export const adminConsoleUrl = adminConsoleUrlFor(import.meta.env)

// ?state= shows a store user's session without starting one from the admin console.
export const staffSession = createPortalSession({
  harnessEnabled,
  sample: (kind, expiresAt) => ({
    id: 'imp-sample',
    kind,
    staffName: 'Neha Rao',
    actingAs: { name: 'Rohan Verma', role: 'Manager', where: 'Mehta Textiles' },
    partnerName: 'Bazaar Cloud',
    host: 'shop.bazaarcloud.in/mehta-textiles',
    expiresAt,
  }),
})
