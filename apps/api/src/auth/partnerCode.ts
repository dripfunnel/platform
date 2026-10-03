import type postgres from 'postgres'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { recordReauthCode, recordWrongCode, selectSecondFactorState, type SecondFactorState } from '#db/scoped/partnerUsers'
import { partnerLocked, partnerReauthenticated, partnerSecondFactorRefused, type ActivityLog, type RequestFacts } from './activity'
import type { SecretBox } from './secretBox'
import { hashSessionId, newSessionId, reauthMs } from './session'
import { checkCode } from './totp'

// ui/platform/FIRST-RELEASE.md §3: five wrong codes pause sign-in for 15 minutes. Sign-in and
// re-authentication (ACCESS.md §8) share the count, so neither is a way round the other.
export const maxCodeTries = 5
export const lockMs = 15 * 60 * 1000

export const minutesUntil = (until: Date, now: Date) => Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000))

export type WrongCode = { code: 'WRONG_CODE'; triesLeft: number } | { code: 'LOCKED'; minutes: number }

/** Counts a wrong code; the one that reaches the limit locks the account and emails its owner. */
export const wrongPartnerCode = async (tx: ScopedSql, activity: ActivityLog, facts: RequestFacts, state: SecondFactorState, now: Date): Promise<WrongCode> => {
  const lockedUntil = new Date(now.getTime() + lockMs)
  const { triesLeft, locked } = await recordWrongCode(tx, state.id, maxCodeTries, lockedUntil)
  if (!locked) return { code: 'WRONG_CODE', triesLeft }
  await activity.record(tx, partnerLocked({ id: state.id, partnerId: state.partner_id }, facts))
  // The "we've emailed you" notice (FIRST-RELEASE §3), delivered once SES is wired (outbox-relay.ts).
  await insertOutbox(tx, {
    kind: 'email',
    idempotencyKey: `partner-user-locked:${state.id}:${lockedUntil.toISOString()}`,
    payload: { template: 'partner-user-locked', partnerUserId: state.id, to: state.email, minutes: lockMs / 60_000 },
    partnerId: state.partner_id,
    storeId: null,
  })
  return { code: 'LOCKED', minutes: lockMs / 60_000 }
}

export type ReauthResult =
  | { ok: true; proof: string; expiresAt: Date }
  | { ok: false; code: 'NOT_CONNECTED' | 'NO_SECOND_FACTOR' | 'CODE_EXPIRED' }
  | ({ ok: false } & WrongCode)

export interface ReauthDeps {
  sql: postgres.Sql
  activity: ActivityLog
  secrets: SecretBox | null
  now: () => Date
}

/**
 * The partner user's 2-factor code buys one proof, valid five minutes and spent by the action it
 * allows (`spend_partner_reauth`); a wrong code counts toward the sign-in lock.
 */
export const reauthenticatePartner = async (deps: ReauthDeps, facts: RequestFacts, partnerUserId: string, code: string): Promise<ReauthResult> => {
  const secrets = deps.secrets
  if (!secrets) return { ok: false, code: 'NOT_CONNECTED' }
  const now = deps.now()
  return withSystemScope(deps.sql, async (tx): Promise<ReauthResult> => {
    const state = await selectSecondFactorState(tx, partnerUserId)
    const secret = state?.two_factor_secret_enc ? await secrets.open(state.two_factor_secret_enc) : null
    if (!state || !secret) return { ok: false, code: 'NO_SECOND_FACTOR' }
    const user = { id: state.id, partnerId: state.partner_id }
    if (state.locked_until && state.locked_until > now) return { ok: false, code: 'LOCKED', minutes: minutesUntil(state.locked_until, now) }
    const checked = await checkCode(secret, code, now, state.last_code_step === null ? null : Number(state.last_code_step))
    if (!checked.ok) {
      await deps.activity.record(tx, partnerSecondFactorRefused(user, facts, checked.code))
      return checked.code === 'WRONG_CODE' ? { ok: false, ...(await wrongPartnerCode(tx, deps.activity, facts, state, now)) } : { ok: false, code: checked.code }
    }
    const proof = newSessionId()
    const expiresAt = new Date(now.getTime() + reauthMs)
    await recordReauthCode(tx, state.id, checked.step, await hashSessionId(proof), expiresAt)
    await deps.activity.record(tx, partnerReauthenticated(user, facts))
    return { ok: true, proof, expiresAt }
  })
}
