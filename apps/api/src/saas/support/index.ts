import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import { reauthenticatePartner, type ReauthResult } from '#auth/partnerCode'
import type { SecretBox } from '#auth/secretBox'
import { hashSessionId, newSessionId } from '#auth/session'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  endSupportSession,
  expireStaleSupportSessions,
  insertSupportSession,
  lockSupportSession,
  reissueSupportHandoff,
  selectLivePortalHost,
  selectOpenSupportSessionOf,
  selectSupportSession,
  selectSupportSessions,
  selectSupportTarget,
  selectSupportTargets,
  type SupportSessionRow,
  type SupportTargetRow,
} from '#db/scoped/supportSessions'
import { partnerEntry, type PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { decodePage, pageOf, type PageRequest } from '#saas/staff/index'

// Partner support sessions (ACCESS.md §8, ui/platform/FIRST-RELEASE.md §12; card #202): read-only,
// 30 minutes, one at a time. The merchant's Allow/Deny of writes is the Store API's.

export const supportSessionMs = 30 * 60 * 1000
export const handoffMs = 5 * 60 * 1000
export const supportPageSize = 25

export const supportAudit = {
  startSupportSession: 'support_session.started',
  returnToSupportSession: 'support_session.link_reissued',
  endSupportSession: 'support_session.ended',
} as const

// §12.1's reasons a session can't start, worded by the console from the facts beside them.
export type StartRefusal = 'STORE_CANCELLED' | 'SUPPORT_OFF' | 'NOT_ACCEPTED' | 'SUSPENDED' | 'COLLEAGUE_IN_SESSION'
// ACCESS.md §8.3's codes, plus the portal host the session opens on not being live yet.
export type SessionRefusal = 'NOT_FOUND' | 'REASON_REQUIRED' | 'REAUTH_REQUIRED' | 'SUPPORT_SESSION_ALREADY_OPEN' | 'PORTAL_NOT_LIVE' | 'NOT_SESSION_OWNER' | 'SESSION_ENDED' | 'SESSION_EXPIRED'

export interface Verdict {
  allowed: boolean
  reason: StartRefusal | SessionRefusal | null
}

const allowed: Verdict = { allowed: true, reason: null }
const refused = (reason: StartRefusal | SessionRefusal): Verdict => ({ allowed: false, reason })
const id = z.guid()
const startInput = z.strictObject({
  membershipId: z.guid(),
  reason: z.string().trim().max(500),
  ticket: z.string().trim().max(500).nullish(),
  proof: z.string().max(200).nullish(),
})

export interface PartnerSupportDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  // Support sessions are a partner user's own, proved with their own second factor: no staff
  // session reaches this service (ACCESS.md §8.1, §8.2; blocked in apis/platform/support.ts).
  user: NonNullable<PartnerCaller['user']>
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  now: () => Date
}

const minutesLeft = (until: Date, at: Date) => Math.max(0, Math.ceil((until.getTime() - at.getTime()) / 60_000))
const statusOf = (t: SupportTargetRow) => (t.user_status === 'suspended' || t.membership_status === 'suspended' ? 'suspended' : t.user_status === 'invited' || t.membership_status === 'invited' ? 'invited' : 'active')

/** Why a session on this user can't start now, in §12.1's order; null when it can. */
const startRefusal = (t: SupportTargetRow, callerId: string): StartRefusal | null => {
  if (t.store_status === 'cancelled' || t.store_status === 'closed') return 'STORE_CANCELLED'
  if (!t.support_access_allowed) return 'SUPPORT_OFF'
  const status = statusOf(t)
  if (status === 'invited') return 'NOT_ACCEPTED'
  if (status === 'suspended') return 'SUSPENDED'
  if (t.open_session_id && t.open_agent_id !== callerId) return 'COLLEAGUE_IN_SESSION'
  return null
}

export const createPartnerSupportService = ({ sql, caller, user, facts, activity, secrets, now }: PartnerSupportDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const mayEndOthers = caller.role === 'partner-owner' || caller.role === 'partner-admin'

  const targetDto = (t: SupportTargetRow, at: Date) => {
    const reason = startRefusal(t, user.id)
    return {
      membershipId: t.membership_id,
      userId: t.user_id,
      name: t.name,
      email: t.email,
      type: t.seller_name === null ? ('store' as const) : ('supplier' as const),
      store: { id: t.store_id, name: t.store_name },
      role: t.role_key,
      supplier: t.seller_name,
      lastSignInAt: t.last_sign_in_at,
      status: statusOf(t),
      start: reason ? refused(reason) : allowed,
      // The facts §12.1's sentences name: who turned support off, who is in a session and for how long.
      storeOwner: reason === 'SUPPORT_OFF' ? t.store_owner : null,
      colleague: reason === 'COLLEAGUE_IN_SESSION' && t.open_agent_name && t.open_expires_at ? { name: t.open_agent_name, minutesLeft: minutesLeft(t.open_expires_at, at) } : null,
      mySessionId: t.open_session_id && t.open_agent_id === user.id ? t.open_session_id : null,
    }
  }
  type TargetDto = ReturnType<typeof targetDto>

  const sessionDto = (s: SupportSessionRow, at: Date) => {
    const mine = s.partner_user_id === user.id
    const open = s.ended_at === null && s.expires_at > at
    // A session nobody ended ran out, even once a later start has closed its row (expireStale).
    const expired = s.ended_by_partner_user_id === null && s.end_reason === null
    const closed: Verdict = expired ? refused('SESSION_EXPIRED') : refused('SESSION_ENDED')
    return {
      id: s.id,
      user: { name: s.user_name, role: s.role_key, supplier: s.seller_name },
      store: { id: s.store_id, name: s.store_name },
      agent: { id: s.partner_user_id, name: s.agent_name },
      you: mine,
      reason: s.reason,
      ticket: s.ticket,
      startedAt: s.started_at,
      expiresAt: s.expires_at,
      endedAt: s.ended_at ?? (open ? null : s.expires_at),
      // §12.3's History: ended by the agent, by a colleague, or ran out.
      endedBy: open ? null : expired ? ('expired' as const) : s.end_reason !== null ? ('store' as const) : s.ended_by_partner_user_id === s.partner_user_id ? ('agent' as const) : ('colleague' as const),
      endedByName: s.ended_by_partner_user_id !== null && s.ended_by_partner_user_id !== s.partner_user_id ? s.ended_by_name : null,
      // ACCESS.md §8.3: each record says what the caller may do to it.
      end: !open ? closed : mine || mayEndOthers ? allowed : refused('NOT_SESSION_OWNER'),
      return: !open ? closed : mine ? allowed : refused('NOT_SESSION_OWNER'),
    }
  }
  type SessionDto = ReturnType<typeof sessionDto>

  const linkFor = (host: string, token: string) => `https://${host}/support/enter?token=${encodeURIComponent(token)}`

  /** Null for a cursor it cannot read. */
  const supportTargets = (search: string | null, page: PageRequest): Promise<{ items: TargetDto[]; pageInfo: PageInfo } | null> => {
    const decoded = decodePage(page, supportPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    const term = search?.trim().slice(0, 100) || null
    return withScope(sql, context, async (tx) => {
      const at = now()
      const rows = await selectSupportTargets(tx, partnerId, term, decoded, decoded.limit, at)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.membership_id }))
      return { items: pageRows.map((r) => targetDto(r, at)), pageInfo }
    })
  }

  const reauthenticate = (code: string): Promise<ReauthResult> => reauthenticatePartner({ sql, activity, secrets, now }, facts, user.id, code)

  type Started = { ok: true; sessionId: string; expiresAt: Date; link: string } | { ok: false; reason: StartRefusal | SessionRefusal | 'INVALID_INPUT'; sessionId?: string }

  const startSupportSession = (raw: unknown): Promise<Started> => {
    const parsed = startInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const { membershipId, reason, ticket, proof } = parsed.data
    if (reason === '') return Promise.resolve({ ok: false, reason: 'REASON_REQUIRED' })
    if (!proof) return Promise.resolve({ ok: false, reason: 'REAUTH_REQUIRED' })
    return withScope(sql, context, async (tx): Promise<Started> => {
      const at = now()
      await expireStaleSupportSessions(tx, { partnerUserId: user.id, membershipId }, at)
      const target = await selectSupportTarget(tx, partnerId, membershipId, at)
      if (!target) return { ok: false, reason: 'NOT_FOUND' }
      const mine = await selectOpenSupportSessionOf(tx, partnerId, user.id, at)
      // §12.2: one at a time; the console offers "End it and continue" with this id.
      if (mine) return { ok: false, reason: 'SUPPORT_SESSION_ALREADY_OPEN', sessionId: mine.id }
      const refusal = startRefusal(target, user.id)
      if (refusal) return { ok: false, reason: refusal }
      const host = await selectLivePortalHost(tx, partnerId)
      if (!host) return { ok: false, reason: 'PORTAL_NOT_LIVE' }
      const token = newSessionId()
      const expiresAt = new Date(at.getTime() + supportSessionMs)
      const inserted = await insertSupportSession(tx, await hashSessionId(proof), {
        partnerId,
        storeId: target.store_id,
        membershipId,
        partnerUserId: user.id,
        reason,
        ticket: ticket || null,
        startedAt: at,
        expiresAt,
        handoffHash: await hashSessionId(token),
        handoffExpiresAt: new Date(at.getTime() + handoffMs),
      })
      // Two starts at once: the open indexes decide, the loser hears which and keeps its proof.
      if (!inserted.ok) return { ok: false, reason: inserted.refused === 'proof' ? 'REAUTH_REQUIRED' : inserted.refused === 'agent' ? 'SUPPORT_SESSION_ALREADY_OPEN' : 'COLLEAGUE_IN_SESSION' }
      await activity.record(
        tx,
        entry({
          category: 'support',
          action: supportAudit.startSupportSession,
          reason,
          storeId: target.store_id,
          access: { kind: 'support_session', id: inserted.id },
          target: { type: 'user', id: target.user_id, label: `${target.name} (${target.store_name})` },
          changes: ticket ? [{ field: 'ticket', before: null, after: ticket }] : [],
        }),
      )
      // The store's Owners hear of every session as it starts (ACCESS.md §8, decided on #337).
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `support-session-started:${inserted.id}`,
        payload: { template: 'support-session-started', supportSessionId: inserted.id },
        partnerId,
        storeId: target.store_id,
      })
      return { ok: true, sessionId: inserted.id, expiresAt, link: linkFor(host, token) }
    })
  }

  /** One change to one session, on the row locked and read again. */
  const onSession = <T>(sessionId: string, work: (tx: ScopedSql, s: SupportSessionRow, dto: SessionDto, at: Date) => Promise<T | { ok: false; reason: SessionRefusal }>) => {
    if (!id.safeParse(sessionId).success) return Promise.resolve({ ok: false as const, reason: 'NOT_FOUND' as const })
    return withScope(sql, context, async (tx) => {
      if (!(await lockSupportSession(tx, partnerId, sessionId))) return { ok: false as const, reason: 'NOT_FOUND' as const }
      const session = await selectSupportSession(tx, partnerId, sessionId)
      if (!session) return { ok: false as const, reason: 'NOT_FOUND' as const }
      const at = now()
      return work(tx, session, sessionDto(session, at), at)
    })
  }

  const sessionEntry = (action: string, s: SupportSessionRow) =>
    entry({ category: 'support', action, reason: null, storeId: s.store_id, access: { kind: 'support_session', id: s.id }, target: { type: 'user', id: s.user_id, label: `${s.user_name} (${s.store_name})` } })

  type ReturnRefusal = SessionRefusal | Extract<StartRefusal, 'SUPPORT_OFF' | 'STORE_CANCELLED' | 'SUSPENDED'>

  const returnToSupportSession = (sessionId: string) =>
    onSession(sessionId, async (tx, s, dto, at): Promise<{ ok: true; link: string; expiresAt: Date } | { ok: false; reason: ReturnRefusal }> => {
      if (!dto.return.allowed) return { ok: false, reason: dto.return.reason as SessionRefusal }
      // What a start would refuse now refuses a fresh link too (ACCESS.md §8: switching support off ends it).
      const target = await selectSupportTarget(tx, partnerId, s.membership_id, at)
      if (!target) return { ok: false, reason: 'NOT_FOUND' }
      const refusal = startRefusal(target, user.id)
      if (refusal === 'SUPPORT_OFF' || refusal === 'STORE_CANCELLED' || refusal === 'SUSPENDED') return { ok: false, reason: refusal }
      const host = await selectLivePortalHost(tx, partnerId)
      if (!host) return { ok: false, reason: 'PORTAL_NOT_LIVE' }
      const token = newSessionId()
      await reissueSupportHandoff(tx, s.id, await hashSessionId(token), new Date(at.getTime() + handoffMs))
      await activity.record(tx, sessionEntry(supportAudit.returnToSupportSession, s))
      return { ok: true, link: linkFor(host, token), expiresAt: s.expires_at }
    })

  const endSession = (sessionId: string) =>
    onSession(sessionId, async (tx, s, dto, at): Promise<{ ok: true } | { ok: false; reason: SessionRefusal }> => {
      if (!dto.end.allowed) return { ok: false, reason: dto.end.reason as SessionRefusal }
      await endSupportSession(tx, s.id, user.id, at)
      await activity.record(tx, sessionEntry(supportAudit.endSupportSession, s))
      return { ok: true }
    })

  /** Null for a cursor it cannot read. */
  const supportSessions = (open: boolean, page: PageRequest): Promise<{ items: SessionDto[]; pageInfo: PageInfo } | null> => {
    const decoded = decodePage(page, supportPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const at = now()
      const rows = await selectSupportSessions(tx, partnerId, open, decoded, decoded.limit, at)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.started_at, id: r.id }))
      return { items: pageRows.map((r) => sessionDto(r, at)), pageInfo }
    })
  }

  const mySupportSession = (): Promise<SessionDto | null> =>
    withScope(sql, context, async (tx) => {
      const at = now()
      const s = await selectOpenSupportSessionOf(tx, partnerId, user.id, at)
      return s ? sessionDto(s, at) : null
    })

  return { supportTargets, reauthenticate, startSupportSession, returnToSupportSession, endSupportSession: endSession, supportSessions, mySupportSession }
}

export type PartnerSupportService = ReturnType<typeof createPartnerSupportService>
export type SupportTargetDto = Awaited<ReturnType<PartnerSupportService['supportTargets']>> extends infer P ? (P extends { items: (infer I)[] } ? I : never) : never
export type SupportSessionDto = NonNullable<Awaited<ReturnType<PartnerSupportService['mySupportSession']>>>
