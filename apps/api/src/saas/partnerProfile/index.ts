import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { minutesUntil, wrongPartnerCode } from '#auth/partnerCode'
import { partnerContextOf, type PartnerCaller } from '#auth/partnerCaller'
import { hashPassword, minPasswordLength, verifyPassword } from '#auth/password'
import { hashSessionId } from '#auth/session'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectPasswordState, setPartnerPassword, setPartnerUserName } from '#db/scoped/partnerProfile'
import { partnerEntry } from '#saas/activity/index'

// My profile in the partner console (#1053; ui/platform/FIRST-RELEASE.md): the signed-in user's own name and
// password. Staff sessions never reach it (apis/platform/profile.ts blocks them).

export const profileAudit = {
  name: 'partner_user.name_changed',
  password: 'partner_user.password_changed',
} as const

export type ProfileResult = { ok: true } | { ok: false; reason: 'INVALID_INPUT' | 'WEAK_PASSWORD' | 'NOT_FOUND' } | { ok: false; reason: 'WRONG_PASSWORD'; triesLeft: number } | { ok: false; reason: 'LOCKED'; minutes: number }

const nameInput = z.string().trim().min(1).max(80)

export interface PartnerProfileDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  /** The session cookie of this request: a password change keeps it and ends the user's others. */
  sessionId: string | null
  now: () => Date
}

export const createPartnerProfileService = ({ sql, caller, facts, activity, sessionId, now }: PartnerProfileDeps) => {
  const user = caller.user
  const entry = partnerEntry(caller, facts)
  // No value in either entry (LOGGING.md): the target says whose, the action what.
  const target = user ? { type: 'partner_user', id: user.id, label: user.email } : null

  const updateName = async (raw: string): Promise<ProfileResult> => {
    const name = nameInput.safeParse(raw)
    if (!name.success) return { ok: false, reason: 'INVALID_INPUT' }
    if (!user || !target) return { ok: false, reason: 'NOT_FOUND' }
    return withScope(sql, partnerContextOf(caller), async (tx): Promise<ProfileResult> => {
      if (!(await setPartnerUserName(tx, user.id, caller.partner.id, name.data))) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, entry({ action: profileAudit.name, target, reason: null }))
      return { ok: true }
    })
  }

  const changePassword = async (current: string, next: string): Promise<ProfileResult> => {
    if (!user || !target) return { ok: false, reason: 'NOT_FOUND' }
    if (next.length < minPasswordLength || next.length > 1024) return { ok: false, reason: 'WEAK_PASSWORD' }
    const passwordHash = await hashPassword(next)
    const keep = sessionId ? await hashSessionId(sessionId) : null
    const at = now()
    return withSystemScope(sql, async (tx): Promise<ProfileResult> => {
      const state = await selectPasswordState(tx, user.id)
      if (!state || state.partner_id !== caller.partner.id) return { ok: false, reason: 'NOT_FOUND' }
      if (state.locked_until && state.locked_until > at) return { ok: false, reason: 'LOCKED', minutes: minutesUntil(state.locked_until, at) }
      // A wrong current password counts toward the sign-in lock, as a wrong code does (FIRST-RELEASE §3).
      if (!(await verifyPassword(current.slice(0, 1024), state.password_hash))) {
        const wrong = await wrongPartnerCode(tx, activity, facts, { ...state, two_factor_secret_enc: null, last_code_step: null }, at)
        return wrong.code === 'LOCKED' ? { ok: false, reason: 'LOCKED', minutes: wrong.minutes } : { ok: false, reason: 'WRONG_PASSWORD', triesLeft: wrong.triesLeft }
      }
      await setPartnerPassword(tx, user.id, passwordHash, keep)
      await activity.record(tx, entry({ action: profileAudit.password, target, reason: null }))
      return { ok: true }
    })
  }

  return { updateName, changePassword }
}

export type PartnerProfileService = ReturnType<typeof createPartnerProfileService>
