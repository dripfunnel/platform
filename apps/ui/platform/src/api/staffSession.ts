import { adminConsoleUrlFor, createPortalSession, isHarnessEnabled } from '@dripfunnel/shared/ui'

export const harnessEnabled = isHarnessEnabled(import.meta.env)

export const adminConsoleUrl = adminConsoleUrlFor(import.meta.env)

// ?state= shows a partner user's impersonation or a setup session without starting one from
// the admin console.
export const staffSession = createPortalSession({
  harnessEnabled,
  sample: (kind, expiresAt) =>
    kind === 'impersonation'
      ? {
          id: 'imp-sample',
          kind,
          staffName: 'Neha Rao',
          actingAs: { name: 'Olivia Grant', role: 'Owner', where: 'Loom & Thread · Partner console' },
          partnerName: 'Loom & Thread',
          host: 'platform.dripfunnel.com',
          expiresAt,
        }
      : { id: 'su-sample', kind, staffName: 'Maya Ortiz', actingAs: null, partnerName: 'Tallis Studio', host: 'platform.dripfunnel.com', expiresAt },
})
