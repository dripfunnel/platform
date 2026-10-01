import { createPortalSession, isHarnessEnabled } from '@dripfunnel/shared/ui'

export const harnessEnabled = isHarnessEnabled(import.meta.env)

// Where the bar's "Back" goes: the admin console's dev port under vite dev, otherwise the
// build's VITE_ADMIN_URL (a feature environment's console) or production's.
const builtAdminUrl: unknown = import.meta.env.VITE_ADMIN_URL
export const adminConsoleUrl = import.meta.env.DEV
  ? 'http://localhost:5175'
  : typeof builtAdminUrl === 'string' && builtAdminUrl.startsWith('https://')
    ? builtAdminUrl
    : 'https://admin.dripfunnel.com'

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
