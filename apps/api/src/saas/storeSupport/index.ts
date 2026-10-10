import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { hashSessionId, newSessionId } from '#auth/session'
import type { StoreCaller } from '#auth/storeCaller'
import { resolveSupportCaller, seatOf, supportActor, writeRequestOf, type SupportSeat } from '#auth/storeSupport'

export { writeRequestOf } from '#auth/storeSupport'
import { pageOf, type Page, type PageWindow } from '#core/paging'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  decideSupportWrite,
  endSupportFromPortal,
  requestSupportWrite,
  selectStoreSupportSessions,
  selectSupportAllowed,
  selectSupportPortalSession,
  setStoreSupportAccess,
  spendSupportHandoff,
  type StoreSupportRow,
  type SupportPortalRow,
} from '#db/scoped/storeSupport'
import { queueSideEffect } from '#saas/outbox/index'

// The store's half of partner support sessions (ACCESS.md §8; #331): the merchant's switch, its
// Allow/Deny and Support access log, and the agent's own side of the session on the portal host.

export const storeSupportAudit = {
  setSupportAccess: 'support_access.changed',
  allowSupportWrite: 'support_session.write_allowed',
  denySupportWrite: 'support_session.write_denied',
  requestSupportWrite: 'support_session.write_requested',
} as const

/** The Support access log's window (SetAccess: "Last 90 days"). */
export const supportLogDays = 90
export const supportLogPageSize = 25

export type EndedBy = 'agent' | 'colleague' | 'store' | 'expired' | 'targetGone' | 'storeClosed'

type Ending = Pick<StoreSupportRow, 'ended_at' | 'expires_at' | 'ended_by_partner_user_id' | 'end_reason'> & { agent: string }

/** Who or what ended a session; null while it is open. A store-side end names its reason (0160). */
const endedByOf = (s: Ending, now: Date): EndedBy | null => {
  if (s.ended_at === null && s.expires_at > now) return null
  if (s.end_reason === 'support_off') return 'store'
  if (s.end_reason === 'target_gone') return 'targetGone'
  if (s.end_reason === 'store_closed') return 'storeClosed'
  if (s.ended_by_partner_user_id === null) return 'expired'
  return s.ended_by_partner_user_id === s.agent ? 'agent' : 'colleague'
}

const sessionDto = (s: StoreSupportRow, now: Date) => ({
  id: s.id,
  agent: { id: s.agent_id, name: s.agent_name },
  partnerName: s.partner_name,
  actingAs: { name: s.user_name, role: s.role_key, supplier: s.seller_name },
  reason: s.reason,
  ticket: s.ticket,
  startedAt: s.started_at,
  expiresAt: s.expires_at,
  // A session nobody ended ran out at its time.
  endedAt: s.ended_at ?? (s.expires_at > now ? null : s.expires_at),
  endedBy: endedByOf({ ...s, agent: s.agent_id }, now),
  endedByName: s.end_reason === 'support_off' ? s.ended_by_user_name : s.ended_by_partner_user_id !== null && s.ended_by_partner_user_id !== s.agent_id ? s.ended_by_agent_name : null,
  access: s.access,
  allowedBy: s.access === 'write' ? s.write_decided_by_name : null,
  writeRequest: writeRequestOf(s),
})
export type StoreSupportSessionDto = ReturnType<typeof sessionDto>

// Not one of this store's open sessions, or nothing asked of it: the merchant can't tell which, nor needs to.
export type DecideRefusal = 'NOT_PENDING'

export interface StoreSupportDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createStoreSupportService = ({ sql, caller, activity, facts, now }: StoreSupportDeps) => {
  const { context } = caller
  const storeId = caller.store.id
  const actor = { actorKind: 'person' as const, actorId: caller.person.id, actorLabel: null }

  // Lifecycle entries are the partner's to see too, as account-level facts about its merchant (LOGGING.md §6).
  const entry = (action: string, target: NonNullable<ActivityEntry['target']>, extra: Partial<Pick<ActivityEntry, 'category' | 'changes' | 'access' | 'reason'>> = {}): ActivityEntry => ({
    category: 'support',
    action,
    result: 'success',
    ...actor,
    partnerId: context.partnerId,
    storeId,
    target,
    reason: null,
    api: 'store',
    visibility: 'partner',
    ...facts,
    ...extra,
  })

  const sessionTarget = (id: string, label: string) => ({ type: 'support_session', id, label })

  /** Settings › Support access: the switch and the log, newest first, of the last 90 days. */
  const supportAccess = (window: PageWindow): Promise<{ allowed: boolean; sessions: Page<StoreSupportSessionDto> }> =>
    withScope(sql, context, async (tx) => {
      const at = now()
      const since = new Date(at.getTime() - supportLogDays * 24 * 60 * 60 * 1000)
      const rows = await selectStoreSupportSessions(tx, since, { after: window.after ?? undefined, before: window.before ?? undefined }, window.limit)
      const page = pageOf(rows, window, (r) => ({ occurredAt: r.started_at, id: r.id }))
      return { allowed: await selectSupportAllowed(tx, storeId), sessions: { nodes: page.nodes.map((r) => sessionDto(r, at)), pageInfo: page.pageInfo } }
    })

  /** On or Off. Off ends every open session at once, each logged as ended by this person (ACCESS.md §8). */
  const setSupportAccess = (allowed: boolean): Promise<{ allowed: boolean; ended: number }> =>
    withScope(sql, context, async (tx) => {
      const at = now()
      const before = await selectSupportAllowed(tx, storeId)
      const ended = await setStoreSupportAccess(tx, allowed, at)
      if (before !== allowed) {
        await activity.record(tx, entry(storeSupportAudit.setSupportAccess, { type: 'store', id: storeId, label: caller.store.name }, { category: 'write', changes: [{ field: 'support_access_allowed', before: String(before), after: String(allowed) }] }))
      }
      await activity.recordAll(tx, ended.map((s) => entry('support_session.ended', sessionTarget(s.session_id, caller.store.name), { access: { kind: 'support_session', id: s.session_id }, reason: 'support_off' })))
      return { allowed, ended: ended.length }
    })

  /** Allow or Deny the agent's open request; a Manager's Allow emails the Owners (decided on #337). */
  const decide = (sessionId: string, allow: boolean): Promise<{ ok: true } | { ok: false; reason: DecideRefusal }> => {
    if (!z.guid().safeParse(sessionId).success) return Promise.resolve({ ok: false, reason: 'NOT_PENDING' })
    return withScope(sql, context, async (tx) => {
      const at = now()
      const decided = await decideSupportWrite(tx, sessionId, allow, at)
      if (!decided) return { ok: false, reason: 'NOT_PENDING' }
      await activity.record(tx, entry(allow ? storeSupportAudit.allowSupportWrite : storeSupportAudit.denySupportWrite, sessionTarget(sessionId, caller.store.name), { access: { kind: 'support_session', id: sessionId } }))
      if (allow && caller.role.side === 'merchant' && caller.role.role === 'manager') {
        await queueSideEffect(tx, { kind: 'email', idempotencyKey: `support-write-allowed:${sessionId}`, payload: { template: 'support-write-allowed', supportSessionId: sessionId }, partnerId: context.partnerId, storeId })
      }
      return { ok: true }
    })
  }

  return { supportAccess, setSupportAccess, decide }
}

export type StoreSupportService = ReturnType<typeof createStoreSupportService>

export type WriteRequestRefusal = 'INVALID_INPUT' | 'ALREADY_ASKED' | 'ALREADY_ALLOWED' | 'SESSION_ENDED'

const noteInput = z.string().trim().min(1).max(500)

/** The agent asks the store to allow changes, with what for (SetAccess banner: "asks to make changes: …"). */
export const askForSupportWrite = (deps: { sql: postgres.Sql; caller: StoreCaller; seat: SupportSeat; activity: ActivityLog; facts: RequestFacts; now: () => Date }, rawNote: string): Promise<{ ok: true } | { ok: false; reason: WriteRequestRefusal }> => {
  const note = noteInput.safeParse(rawNote)
  if (!note.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
  const { seat, caller } = deps
  // System scope: the session's own row, by the id resolved from its cookie, never from input.
  return withSystemScope(deps.sql, async (tx) => {
    const outcome = await requestSupportWrite(tx, seat.sessionId, note.data, deps.now())
    if (outcome === 'closed') return { ok: false, reason: 'SESSION_ENDED' }
    if (outcome === 'pending') return { ok: false, reason: 'ALREADY_ASKED' }
    if (outcome === 'allowed') return { ok: false, reason: 'ALREADY_ALLOWED' }
    await deps.activity.record(tx, {
      category: 'support',
      action: storeSupportAudit.requestSupportWrite,
      result: 'success',
      ...supportActor(seat),
      partnerId: caller.context.partnerId,
      storeId: caller.store.id,
      target: { type: 'support_session', id: seat.sessionId, label: caller.store.name },
      reason: null,
      api: 'store',
      visibility: 'partner',
      ...deps.facts,
    })
    return { ok: true }
  })
}

// The agent's side on the portal host (ACCESS.md §8.3's contract, as #243 built for staff sessions).

export const portalSupportDto = (s: SupportPortalRow, now: Date) => ({
  id: s.id,
  state: s.ended_at === null && s.expires_at > now ? ('open' as const) : s.ended_at === null || (s.ended_by_partner_user_id === null && s.end_reason === null) ? ('expired' as const) : ('ended' as const),
  endedBy: endedByOf({ ...s, agent: s.partner_user_id }, now),
  partnerName: s.partner_name,
  agentName: s.agent_name,
  actingAs: { name: s.user_name, role: s.role_key, supplier: s.seller_name },
  store: { id: s.store_id, name: s.store_name },
  access: s.access,
  writeRequest: writeRequestOf(s),
  expiresAt: s.expires_at.toISOString(),
})
export type PortalSupportDto = ReturnType<typeof portalSupportDto>

interface PortalDeps {
  sql: postgres.Sql
  partnerId: string
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

const enteredEntry = (row: SupportPortalRow, facts: RequestFacts): ActivityEntry => ({
  category: 'support',
  action: 'support_session.entered',
  result: 'success',
  ...supportActor(seatOf(row)),
  partnerId: row.partner_id,
  storeId: row.store_id,
  target: { type: 'user', id: row.user_id, label: `${row.user_name} (${row.store_name})` },
  reason: null,
  api: 'store',
  visibility: 'partner',
  ...facts,
})

/** Spends the one-time link for a fresh support cookie; null when the link no longer works (`HANDOFF_INVALID`). */
export const exchangeSupportHandoff = async (deps: PortalDeps, token: string): Promise<{ cookie: string; session: PortalSupportDto } | null> => {
  const cookie = newSessionId()
  const at = deps.now()
  return withSystemScope(deps.sql, async (tx) => {
    const portalHash = await hashSessionId(cookie)
    if (!(await spendSupportHandoff(tx, deps.partnerId, await hashSessionId(token), portalHash, at))) return null
    const row = await selectSupportPortalSession(tx, deps.partnerId, portalHash)
    if (!row) return null
    await deps.activity.record(tx, enteredEntry(row, deps.facts))
    return { cookie, session: portalSupportDto(row, at) }
  })
}

/** Ends one its store can no longer host on the way (as every request does), then reads it, open or not. */
const readPortal = async (tx: ScopedSql, deps: PortalDeps, cookie: string): Promise<SupportPortalRow | null> => {
  await resolveSupportCaller(tx, deps.partnerId, cookie, deps.now(), deps.activity, deps.facts)
  return selectSupportPortalSession(tx, deps.partnerId, await hashSessionId(cookie))
}

/** The cookie's session for the agent's bar, polled every 15 seconds (ACCESS.md §8.3). */
export const currentSupportSession = (deps: PortalDeps, cookie: string): Promise<PortalSupportDto | null> =>
  withSystemScope(deps.sql, async (tx) => {
    const row = await readPortal(tx, deps, cookie)
    return row && portalSupportDto(row, deps.now())
  })

/** The bar's "End now": ended by the agent, logged as the session; false when none was open to end. */
export const endSupportSessionFromPortal = (deps: PortalDeps, cookie: string, id: string): Promise<boolean> =>
  withSystemScope(deps.sql, async (tx) => {
    const row = await readPortal(tx, deps, cookie)
    if (!row || row.id !== id || !(await endSupportFromPortal(tx, row.id, row.partner_user_id, deps.now()))) return false
    await deps.activity.record(tx, { ...enteredEntry(row, deps.facts), action: 'support_session.ended' })
    return true
  })
