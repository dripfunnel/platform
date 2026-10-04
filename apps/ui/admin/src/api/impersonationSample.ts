// Staff sessions served the way #40 will, refusals included (the contract agreed on #46): a
// fixture that permits a second extend or a Support setup session would teach the UI to allow them.
import { encodeFixtureHandoff } from '@dripfunnel/shared/ui'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import { roleText, whereText } from '../features/impersonate/sessionText'
import type { StaffRole } from '../features/shell/staffRoles'
import type {
  ImpersonationTarget,
  Membership,
  Reauth,
  Ref,
  SessionFilter,
  SessionKind,
  SessionLookup,
  SessionOutcome,
  SessionPage,
  SessionPermission,
  SessionRefusal,
  SessionResult,
  StaffSession,
  StartResult,
  TargetFilter,
  TargetKind,
  TargetPage,
  TargetStatus,
} from './impersonation'
import { samplePartners } from './partnersSample'
import { impersonatePermission, impersonators, setupStarters } from './sessionRules'
import { sampleStores } from './storesSample'

type SampleReauth = { ok: true; proof: string } | Extract<Reauth, { ok: false }>

const minuteMs = 60_000
const impersonationMs = 30 * minuteMs
const setupMs = 120 * minuteMs
const platformHost = 'platform.dripfunnel.com'

// Where the dev servers run the two portals; a deployed fixture opens the same paths on them.
const portalOrigins = { partner: 'http://localhost:5174', store: 'http://localhost:5173' }

// The sample's staff, one per role, so a harness caller has a name (ids match the activity sample).
const staffByRole: Record<StaffRole, Ref> = {
  'staff-super-admin': { id: 'st-arjun', name: 'Arjun Menon' },
  'staff-partner-manager': { id: 'st-priya', name: 'Priya Shah' },
  'staff-support': { id: 'st-neha', name: 'Neha Rao' },
  'staff-finance': { id: 'st-tom', name: 'Tom Becker' },
  'staff-engineer': { id: 'st-lena', name: 'Lena Fischer' },
  'staff-read-only': { id: 'st-sam', name: 'Sam Lee' },
}
const otherStaff: Ref = { id: 'st-maya', name: 'Maya Ortiz' }

interface SampleTarget {
  id: string
  name: string
  email: string
  kind: TargetKind
  memberships: Membership[]
  lastSignInAt: string | null
  status: TargetStatus
}

const partnerRef = (id: string): Ref => ({ id, name: samplePartners.find((partner) => partner.id === id)?.name ?? id })
const partnerClosed = (id: string) => samplePartners.find((partner) => partner.id === id)?.state === 'closed'
const portalHostOf = (partnerId: string) =>
  samplePartners.find((partner) => partner.id === partnerId)?.domains.find((domain) => domain.kind === 'portal')?.host ?? 'store.dripfunnel.com'

// Partner users are one pool and store users another (ACCESS.md §2): never merged. A store user is
// one account per partner, so the same email in two of its stores is one person with two places.
const buildTargets = (): SampleTarget[] => {
  const partnerUsers = samplePartners.flatMap((partner) =>
    partner.team.map(
      (user): SampleTarget => ({
        id: user.id,
        name: user.name,
        email: user.email,
        kind: 'partnerUser',
        memberships: [{ id: user.id, level: 'partner', partner: partnerRef(partner.id), role: user.role }],
        lastSignInAt: user.lastSignInAt,
        status: user.status,
      }),
    ),
  )
  const accounts = new Map<string, SampleTarget>()
  for (const store of sampleStores) {
    for (const user of store.users) {
      const key = `${store.partner.id}:${user.email}`
      const membership: Membership = { id: user.id, level: 'store', partner: store.partner, store: { id: store.id, name: store.name }, role: user.role, supplier: user.supplier }
      const existing = accounts.get(key)
      if (existing) {
        existing.memberships.push(membership)
        if ((user.lastSignInAt ?? '') > (existing.lastSignInAt ?? '')) existing.lastSignInAt = user.lastSignInAt
        continue
      }
      accounts.set(key, {
        id: user.id,
        name: user.name,
        email: user.email,
        kind: user.supplier ? 'supplierUser' : 'storeUser',
        memberships: [membership],
        lastSignInAt: user.lastSignInAt,
        status: user.status,
      })
    }
  }
  return [...partnerUsers, ...accounts.values()]
}

interface SampleSession {
  id: string
  kind: SessionKind
  staff: Ref
  targetId: string | null
  membership: Membership | null
  partner: Ref
  reason: string
  ticket: string | null
  startedAt: number
  expiresAt: number
  endedAt: number | null
  extendedAt: number | null
  outcome: SessionOutcome
}

export interface ImpersonationServerOptions {
  now?: () => number
  reauthDelayMs?: number
}

export const createImpersonationServer = (options: ImpersonationServerOptions = {}) => {
  const now = options.now ?? Date.now
  const reauthDelayMs = options.reauthDelayMs ?? 1200
  const targets = buildTargets()
  const proofs = new Set<string>()
  let serial = 0

  const targetById = (id: string) => targets.find((target) => target.id === id)
  const byMembership = (membershipId: string) => targets.find((target) => target.memberships.some((membership) => membership.id === membershipId))
  const membershipOf = (membershipId: string): Membership => {
    const found = byMembership(membershipId)?.memberships.find((membership) => membership.id === membershipId)
    if (!found) throw new Error(`No sample membership ${membershipId}.`)
    return found
  }

  const start = now()
  const seed = (session: Omit<SampleSession, 'partner' | 'extendedAt' | 'endedAt'> & Partial<Pick<SampleSession, 'partner' | 'extendedAt' | 'endedAt'>>): SampleSession => ({
    extendedAt: null,
    endedAt: null,
    partner: session.membership?.partner ?? { id: '', name: '' },
    ...session,
  })
  const ago = (minutes: number) => start - minutes * minuteMs
  // The prototype's stories; imp-7Q2 and su-4K9 are the activity sample's, so its links resolve.
  let sessions: SampleSession[] = [
    seed({ id: 'imp-open1', kind: 'impersonation', staff: staffByRole['staff-support'], targetId: 's1-u2', membership: membershipOf('s1-u2'), reason: 'Can’t publish the Diwali collection', ticket: 'https://support.dripfunnel.com/t/48240', startedAt: ago(1), expiresAt: ago(1) + impersonationMs, outcome: 'open' }),
    seed({ id: 'su-open1', kind: 'setup', staff: otherStaff, targetId: null, membership: null, partner: partnerRef('ts'), reason: 'Partner asked for help with its plans', ticket: null, startedAt: ago(40), expiresAt: ago(40) + setupMs, outcome: 'open' }),
    seed({ id: 'imp-7Q2', kind: 'impersonation', staff: staffByRole['staff-support'], targetId: 's1-u1', membership: membershipOf('s1-u1'), reason: 'Ticket #4821: Diwali collection missing', ticket: null, startedAt: ago(7), expiresAt: ago(7) + impersonationMs, endedAt: ago(2), outcome: 'endedByStaff' }),
    seed({ id: 'su-4K9', kind: 'setup', staff: staffByRole['staff-partner-manager'], targetId: null, membership: null, partner: partnerRef('kl'), reason: 'Partner asked for help with branding', ticket: null, startedAt: ago(60 * 30), expiresAt: ago(60 * 30) + setupMs, endedAt: ago(60 * 30 - 25), outcome: 'endedByStaff' }),
    seed({ id: 'imp-h2', kind: 'impersonation', staff: staffByRole['staff-super-admin'], targetId: 'mayachen', membership: membershipOf('mayachen'), reason: 'Scale plan price not showing on the signup page', ticket: null, startedAt: ago(60 * 24 * 4), expiresAt: ago(60 * 24 * 4) + impersonationMs, endedAt: ago(60 * 24 * 4) + impersonationMs, outcome: 'expired' }),
    seed({ id: 'imp-h3', kind: 'impersonation', staff: staffByRole['staff-support'], targetId: 's1-u1', membership: membershipOf('s1-u1'), reason: 'Size chart not showing', ticket: 'https://support.dripfunnel.com/t/48102', startedAt: ago(60 * 24 * 10), expiresAt: ago(60 * 24 * 10) + impersonationMs, endedAt: ago(60 * 24 * 10 - 14), outcome: 'endedByStaff' }),
  ]

  // Expiry is the server's: an open session past its end is expired the next time anyone reads it.
  const settle = () => {
    sessions = sessions.map((session) =>
      session.outcome === 'open' && now() >= session.expiresAt ? { ...session, outcome: 'expired', endedAt: session.expiresAt } : session,
    )
  }

  const staffOf = (caller: StaffRole) => staffByRole[caller]
  const openOf = (caller: StaffRole, kind: SessionKind) => sessions.find((session) => session.outcome === 'open' && session.kind === kind && session.staff.id === staffOf(caller).id)

  const toTarget = (target: SampleTarget, caller: StaffRole): ImpersonationTarget => {
    const open = sessions.find((session) => session.outcome === 'open' && session.targetId === target.id && session.staff.id === staffOf(caller).id)
    return {
      ...target,
      impersonate: impersonatePermission(caller, target.status, target.memberships.every((membership) => partnerClosed(membership.partner.id))),
      openSession: open?.id ?? null,
    }
  }

  const matchesTarget = (target: SampleTarget, filter: TargetFilter, search: string | null) => {
    const q = search?.trim().toLowerCase() ?? ''
    return (
      (!filter.type || target.kind === filter.type) &&
      (!filter.partner || target.memberships.some((membership) => membership.partner.id === filter.partner)) &&
      (!filter.store || target.memberships.some((membership) => membership.level === 'store' && membership.store.id === filter.store)) &&
      (!filter.role || target.memberships.some((membership) => membership.role === filter.role)) &&
      (!filter.status || target.status === filter.status) &&
      (q === '' || target.name.toLowerCase().includes(q) || target.email.toLowerCase().includes(q))
    )
  }

  // Never staff, never shoppers (ACCESS.md §8.1): only the two user pools are in the list at all.
  const targetsPage = (filter: TargetFilter, page: PageRequest, search: string | null, size: number, caller: StaffRole): TargetPage | null => {
    if (!impersonators.includes(caller)) return null
    settle()
    const all = targets
      .filter((target) => matchesTarget(target, filter, search))
      .sort((a, b) => (b.lastSignInAt ?? '').localeCompare(a.lastSignInAt ?? '') || a.name.localeCompare(b.name))
    const { items, pageInfo } = pageByCursor(all, page, size)
    return {
      items: items.map((target) => toTarget(target, caller)),
      pageInfo,
      partners: samplePartners.map((partner) => ({ id: partner.id, name: partner.name })),
      stores: sampleStores.map((store) => ({ id: store.id, name: store.name, partnerId: store.partner.id })),
    }
  }

  const target = (membershipId: string, caller: StaffRole): ImpersonationTarget | null => {
    settle()
    const found = byMembership(membershipId)
    return found ? toTarget(found, caller) : null
  }

  const hostOf = (session: Pick<SampleSession, 'membership'>) =>
    session.membership?.level === 'store' ? `${portalHostOf(session.membership.partner.id)}/${storeCodeOf(session.membership.store.id)}` : platformHost

  const permissionsOf = (session: SampleSession, caller: StaffRole): StaffSession['actions'] => {
    if (session.outcome !== 'open') return {}
    const mine = session.staff.id === staffOf(caller).id
    const actions: StaffSession['actions'] = {
      end: mine || caller === 'staff-super-admin' ? { allowed: true } : { allowed: false, reason: 'NOT_SESSION_OWNER' },
    }
    if (mine) actions.return = { allowed: true }
    if (mine && session.kind === 'impersonation') {
      actions.extend = session.extendedAt === null ? { allowed: true } : { allowed: false, reason: 'IMPERSONATION_ALREADY_EXTENDED' }
    }
    return actions
  }

  const toSession = (session: SampleSession, caller: StaffRole): StaffSession => {
    const target = session.targetId ? targetById(session.targetId) : undefined
    const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString())
    return {
      id: session.id,
      kind: session.kind,
      staff: session.staff,
      target: target ? { id: target.id, name: target.name } : null,
      membership: session.membership,
      partner: session.partner,
      store: session.membership?.level === 'store' ? session.membership.store : null,
      host: hostOf(session),
      reason: session.reason,
      ticket: session.ticket,
      startedAt: new Date(session.startedAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
      endedAt: iso(session.endedAt),
      extendedAt: iso(session.extendedAt),
      outcome: session.outcome,
      mine: session.staff.id === staffOf(caller).id,
      actions: permissionsOf(session, caller),
    }
  }

  const dayMs = 86_400_000
  const since = (date: SessionFilter['date']) => {
    const today = now() - (now() % dayMs)
    return date === 'today' ? today : date === '7d' ? today - 6 * dayMs : date === '30d' ? today - 29 * dayMs : 0
  }

  // What a role may see: Support and Super admins every session, a Partner manager setup sessions only.
  const visible = (session: SampleSession, caller: StaffRole) =>
    impersonators.includes(caller) || (caller === 'staff-partner-manager' && session.kind === 'setup')

  const matchesSession = (session: SampleSession, filter: SessionFilter) =>
    (!filter.kind || session.kind === filter.kind) &&
    (!filter.staff || session.staff.id === filter.staff) &&
    (!filter.partner || session.partner.id === filter.partner) &&
    (!filter.store || (session.membership?.level === 'store' && session.membership.store.id === filter.store)) &&
    session.startedAt >= since(filter.date)

  const sessionsPage = (filter: SessionFilter, page: PageRequest, size: number, caller: StaffRole): SessionPage | null => {
    if (!impersonators.includes(caller)) return null
    settle()
    const matching = sessions.filter((session) => matchesSession(session, filter)).sort((a, b) => b.startedAt - a.startedAt)
    const history = pageByCursor(matching.filter((session) => session.outcome !== 'open'), page, size)
    const staff = [...new Map(sessions.map((session) => [session.staff.id, session.staff])).values()]
    return {
      open: matching.filter((session) => session.outcome === 'open').map((session) => toSession(session, caller)),
      history: { items: history.items.map((session) => toSession(session, caller)), pageInfo: history.pageInfo },
      staff,
      partners: samplePartners.map((partner) => ({ id: partner.id, name: partner.name })),
      stores: sampleStores.map((store) => ({ id: store.id, name: store.name })),
    }
  }

  const session = (id: string, caller: StaffRole): SessionLookup => {
    settle()
    const found = sessions.find((candidate) => candidate.id === id)
    if (!found) return { kind: 'notFound' }
    return visible(found, caller) ? { kind: 'found', session: toSession(found, caller) } : { kind: 'denied' }
  }

  const openCount = () => {
    settle()
    return sessions.filter((candidate) => candidate.outcome === 'open').length
  }

  const mine = (caller: StaffRole): StaffSession[] => {
    settle()
    return sessions.filter((candidate) => candidate.outcome === 'open' && candidate.staff.id === staffOf(caller).id).map((candidate) => toSession(candidate, caller))
  }

  // The sample proves a sign-in with a one-time proof; the API stamps the session instead.
  const reauthenticate = (simulate: Reauth | null): Promise<SampleReauth> =>
    new Promise((resolve) =>
      setTimeout(() => {
        if (simulate && !simulate.ok) return resolve(simulate)
        const proof = `reauth-${++serial}`
        proofs.add(proof)
        resolve({ ok: true, proof })
      }, reauthDelayMs),
    )

  // A proof works once, so a replayed request has to sign in again.
  const spend = (proof: string) => proofs.delete(proof)

  const refused = (reason: SessionRefusal) => ({ ok: false as const, reason })

  const handoffFor = (session: SampleSession): string => {
    const target = session.targetId ? targetById(session.targetId) : undefined
    const origin = session.membership?.level === 'store' ? portalOrigins.store : portalOrigins.partner
    const token = encodeFixtureHandoff(
      {
        id: session.id,
        kind: session.kind,
        staffName: session.staff.name,
        actingAs: target && session.membership ? { name: target.name, role: roleText(session.membership), where: whereText(session.membership) } : null,
        partnerName: session.partner.name,
        host: hostOf(session),
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
      String(++serial),
    )
    return `${origin}/impersonate/enter?token=${encodeURIComponent(token)}`
  }

  const opened = (created: SampleSession, caller: StaffRole): StartResult => ({ ok: true, session: toSession(created, caller), handoff: handoffFor(created) })

  const startImpersonation = (targetId: string, membershipId: string, reason: string, ticket: string | null, proof: string, caller: StaffRole): StartResult => {
    settle()
    if (!impersonators.includes(caller)) return refused('STAFF_ROLE_NOT_ALLOWED')
    if (reason.trim() === '') return refused('REASON_REQUIRED')
    if (!spend(proof)) return refused('REAUTH_REQUIRED')
    const target = targetById(targetId)
    const membership = target?.memberships.find((candidate) => candidate.id === membershipId)
    if (!target || !membership) return refused('NOT_FOUND')
    const permission = impersonatePermission(caller, target.status, partnerClosed(membership.partner.id))
    if (!permission.allowed) return refused(permission.reason)
    if (openOf(caller, 'impersonation')) return refused('IMPERSONATION_ALREADY_OPEN')
    const created = seed({ id: `imp-${++serial}`, kind: 'impersonation', staff: staffOf(caller), targetId, membership, reason: reason.trim(), ticket, startedAt: now(), expiresAt: now() + impersonationMs, outcome: 'open' })
    sessions = [created, ...sessions]
    return opened(created, caller)
  }

  const startSetup = (partnerId: string, reason: string, ticket: string | null, proof: string, caller: StaffRole): StartResult => {
    settle()
    if (!setupStarters.includes(caller)) return refused('STAFF_ROLE_NOT_ALLOWED')
    if (reason.trim() === '') return refused('REASON_REQUIRED')
    if (!spend(proof)) return refused('REAUTH_REQUIRED')
    if (!samplePartners.some((partner) => partner.id === partnerId)) return refused('NOT_FOUND')
    if (partnerClosed(partnerId)) return refused('PARTNER_CLOSED')
    // One open per staff member, and a second attempt is refused rather than ending the first (ACCESS.md §8.2).
    if (openOf(caller, 'setup')) return refused('SETUP_SESSION_ALREADY_OPEN')
    const created = seed({ id: `su-${++serial}`, kind: 'setup', staff: staffOf(caller), targetId: null, membership: null, partner: partnerRef(partnerId), reason: reason.trim(), ticket, startedAt: now(), expiresAt: now() + setupMs, outcome: 'open' })
    sessions = [created, ...sessions]
    return opened(created, caller)
  }

  const openSession = (id: string): SampleSession | SessionRefusal => {
    settle()
    const found = sessions.find((candidate) => candidate.id === id)
    if (!found) return 'NOT_FOUND'
    if (found.outcome === 'expired') return 'SESSION_EXPIRED'
    if (found.outcome !== 'open') return 'SESSION_ENDED'
    return found
  }

  const returnTo = (id: string, caller: StaffRole): StartResult => {
    const found = openSession(id)
    if (typeof found === 'string') return refused(found)
    if (found.staff.id !== staffOf(caller).id) return refused('NOT_SESSION_OWNER')
    return opened(found, caller)
  }

  const end = (id: string, caller: StaffRole): SessionResult => {
    const found = openSession(id)
    if (typeof found === 'string') return refused(found)
    const permission: SessionPermission | undefined = permissionsOf(found, caller).end
    if (!permission?.allowed) return refused(permission?.reason ?? 'NOT_SESSION_OWNER')
    sessions = sessions.map((candidate) => (candidate.id === id ? { ...candidate, outcome: 'endedByStaff', endedAt: now() } : candidate))
    return { ok: true }
  }

  // Once, by 30 minutes, and only by whoever is acting (decided on #46); `extendedAt` refuses the second.
  const extend = (id: string, caller: StaffRole): SessionResult => {
    const found = openSession(id)
    if (typeof found === 'string') return refused(found)
    if (found.kind === 'setup') return refused('SETUP_SESSION_NOT_EXTENDABLE')
    if (found.staff.id !== staffOf(caller).id) return refused('NOT_SESSION_OWNER')
    if (found.extendedAt !== null) return refused('IMPERSONATION_ALREADY_EXTENDED')
    sessions = sessions.map((candidate) => (candidate.id === id ? { ...candidate, extendedAt: now(), expiresAt: candidate.expiresAt + impersonationMs } : candidate))
    return { ok: true }
  }

  // The portal side ending it, as the API will report it to the console.
  const endFromPortal = (id: string) => {
    sessions = sessions.map((candidate) => (candidate.id === id && candidate.outcome === 'open' ? { ...candidate, outcome: 'endedFromPortal', endedAt: now() } : candidate))
  }

  return { targets: targetsPage, target, sessions: sessionsPage, session, openCount, mine, reauthenticate, startImpersonation, startSetup, returnTo, end, extend, endFromPortal }
}

const storeCodeOf = (storeId: string) => sampleStores.find((store) => store.id === storeId)?.code ?? storeId

export const impersonationServer = createImpersonationServer()
