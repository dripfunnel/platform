import { adminConsoleUrlFor, createPortalSession, type PortalSessionApi } from '@dripfunnel/shared/ui'
import type { PortalStaffSession } from '@dripfunnel/shared/ui'
import { z } from 'zod'
import { harnessEnabled } from '../harness'
import { messages } from '../messages'
import { query } from './client'

export const adminConsoleUrl = adminConsoleUrlFor(import.meta.env)

// The partner console's staff-session routes (ACCESS.md §8.3, #243): the cookie they read is the
// staff member's own, beside any partner user's.
const sessionSchema = z.object({
  id: z.string(),
  kind: z.enum(['impersonation', 'setup']),
  state: z.enum(['open', 'ended', 'expired']),
  endedBy: z.enum(['staff', 'portal', 'expiry', 'targetGone', 'partnerClosed']).nullable(),
  staffName: z.string(),
  actingAs: z.object({ name: z.string(), role: z.string() }).nullable(),
  partnerName: z.string(),
  host: z.string(),
  expiresAt: z.string(),
})

const roleWords: Record<string, string> = messages.shell.roles

// A user who left or a partner that closed ended it as surely as staff did.
const endedByOf = { staff: 'admin', portal: 'portal', expiry: 'expiry', targetGone: 'admin', partnerClosed: 'admin' } as const

const toSession = (s: z.infer<typeof sessionSchema>): PortalStaffSession => ({
  ...s,
  endedBy: s.endedBy && endedByOf[s.endedBy],
  actingAs: s.actingAs && { name: s.actingAs.name, role: roleWords[s.actingAs.role] ?? s.actingAs.role, where: `${s.partnerName} · ${messages.shell.navLabel}` },
})

const post = async (route: string, body: Record<string, unknown>): Promise<unknown> => {
  const response = await fetch(`/api/auth/${route}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  return response.json()
}

const answer = z.object({ session: sessionSchema.nullable() })

const noticeSchema = z.object({
  staffSessionNotice: z.object({ kind: z.enum(['impersonation', 'setup']), staffName: z.string(), actingAs: z.string().nullable(), endsAt: z.string() }).nullable(),
})

const api: PortalSessionApi = {
  exchange: async (token) => {
    const parsed = answer.safeParse(await post('handoff', { token }))
    return parsed.success && parsed.data.session ? toSession(parsed.data.session) : null
  },
  // A refused poll (over the limit, signed out, unreadable) rejects: the poll keeps its last answer
  // on screen (usePolling), and the shared reads never take it for "no session".
  current: async () => {
    const parsed = answer.safeParse(await post('staff-session', {}))
    if (!parsed.success) throw new Error('The staff-session poll was refused.')
    return parsed.data.session && toSession(parsed.data.session)
  },
  // A setup session's notice is the shell's own banner (PartnerBanners); this one is an impersonation's.
  notice: async () => {
    const { staffSessionNotice: n } = await query(`{ staffSessionNotice { kind staffName actingAs endsAt } }`, noticeSchema)
    if (!n || n.kind !== 'impersonation') return null
    return { id: 'notice', kind: n.kind, state: 'open', endedBy: null, staffName: n.staffName, actingAs: n.actingAs ? { name: n.actingAs, role: '', where: '' } : null, partnerName: '', host: '', expiresAt: n.endsAt }
  },
  // A refused end throws, so the bar says it didn't end (StaffSessionLayer's endFailed).
  end: async (id) => {
    if (!z.object({ ok: z.literal(true) }).safeParse(await post('end-staff-session', { id })).success) throw new Error('The session did not end.')
  },
}

// ?state= shows a partner user's impersonation or a setup session without starting one from
// the admin console.
export const staffSession = createPortalSession({
  harnessEnabled,
  api,
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
