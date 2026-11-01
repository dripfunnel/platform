import { adminConsoleUrlFor, createPortalSession, type PortalSessionApi, type PortalStaffSession } from '@dripfunnel/shared/ui'
import { z } from 'zod'
import { rememberActing } from '../acting'
import { harnessEnabled } from '../harness'
import { messages } from '../messages'
import { query } from './client'

export { harnessEnabled } from '../harness'

export const adminConsoleUrl = adminConsoleUrlFor(import.meta.env)

// The Store API's staff-session routes (ACCESS.md §8.3): the cookie they read is the staff
// member's own, beside any person's, and bound to the one seat the session was started in.
const sessionSchema = z.object({
  id: z.string(),
  kind: z.literal('impersonation'),
  state: z.enum(['open', 'ended', 'expired']),
  endedBy: z.enum(['staff', 'portal', 'expiry', 'targetGone', 'partnerClosed']).nullable(),
  staffName: z.string(),
  actingAs: z.object({ name: z.string(), role: z.string(), store: z.string(), supplier: z.string().nullable() }),
  partnerName: z.string(),
  host: z.string(),
  expiresAt: z.string(),
})

const roleWords: Record<string, string> = { ...messages.shell.roles, ...messages.supplierTeam.roles }

// A user who left or a partner that closed ended it as surely as staff did.
const endedByOf = { staff: 'admin', portal: 'portal', expiry: 'expiry', targetGone: 'admin', partnerClosed: 'admin' } as const

const toSession = (s: z.infer<typeof sessionSchema>): PortalStaffSession => ({
  ...s,
  endedBy: s.endedBy && endedByOf[s.endedBy],
  actingAs: { name: s.actingAs.name, role: roleWords[s.actingAs.role] ?? s.actingAs.role, where: s.actingAs.supplier ? `${s.actingAs.supplier} · ${s.actingAs.store}` : s.actingAs.store },
})

/** A Store API auth route's JSON answer (`/api/auth/<route>`); no answer, or one that isn't JSON, throws. */
export const postAuth = async (route: string, body: Record<string, unknown>): Promise<unknown> => {
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
  staffSessionNotice: z.object({ kind: z.literal('impersonation'), staffName: z.string(), actingAs: z.string().nullable(), endsAt: z.string() }).nullable(),
})

const api: PortalSessionApi = {
  exchange: async (token) => {
    const parsed = answer.safeParse(await postAuth('handoff', { token }))
    if (!parsed.success || !parsed.data.session) return null
    // The session names its own store; one remembered from before would read as a crossing.
    rememberActing(null)
    return toSession(parsed.data.session)
  },
  // A refused poll rejects: the bar keeps its last answer (usePolling), never "no session".
  current: async () => {
    const parsed = answer.safeParse(await postAuth('staff-session', {}))
    if (!parsed.success) throw new Error('The staff-session poll was refused.')
    return parsed.data.session && toSession(parsed.data.session)
  },
  notice: async () => {
    const { staffSessionNotice: n } = await query(`{ staffSessionNotice { kind staffName actingAs endsAt } }`, noticeSchema)
    if (!n) return null
    return { id: 'notice', kind: n.kind, state: 'open', endedBy: null, staffName: n.staffName, actingAs: n.actingAs ? { name: n.actingAs, role: '', where: '' } : null, partnerName: '', host: '', expiresAt: n.endsAt }
  },
  // A refused end throws, so the bar says it didn't end (StaffSessionLayer's endFailed).
  end: async (id) => {
    if (!z.object({ ok: z.literal(true) }).safeParse(await postAuth('end-staff-session', { id })).success) throw new Error('The session did not end.')
  },
}

// ?state= shows a store user's session without starting one from the admin console.
export const staffSession = createPortalSession({
  harnessEnabled,
  api,
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
