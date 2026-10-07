import { hashSmsCode, maxSmsCodeAttempts, newSmsCode, smsCodeMs } from '#auth/storeCodes'
import { codeMatches } from '#auth/codeCheck'
import { personLocked, type ActivityLog, type RequestFacts } from '#auth/activity'
import { lockMs, maxCodeTries } from '#auth/partnerCode'
import type { ScopedSql } from '#db/scoped/index'
import { selectPortalBrand } from '#db/scoped/portalBrand'
import { bumpCodeAttempt, insertVerificationCode, markCodeUsed, recordUserWrongCode, selectLiveCode } from '#db/scoped/userSignIn'
import { queueSideEffect } from '#saas/outbox/index'
import { queueSms } from '#saas/sms/index'

// Texted codes, the brand they're sent in, and the one wrong-try count, for sign-in, enrolment and My profile (ACCESS.md §4).

/** The partner's brand name: the authenticator's issuer and the sender of every text (white label). */
export const brandName = async (tx: ScopedSql, partnerId: string, now: Date): Promise<string> => {
  const brand = await selectPortalBrand(tx, partnerId, now)
  if (!brand) throw new Error('store auth: the host resolved to a partner with no brand row')
  return (brand.product_name ?? brand.partner_name).slice(0, 30)
}

export const textCode = async (tx: ScopedSql, partnerId: string, userId: string, phone: string, purpose: 'sign_in' | 'enrol_phone', now: Date): Promise<void> => {
  const id = crypto.randomUUID()
  const code = newSmsCode()
  const expiresAt = new Date(now.getTime() + smsCodeMs)
  await insertVerificationCode(tx, { id, partnerId, userId, purpose, hash: await hashSmsCode(id, code), expiresAt, createdAt: now })
  await queueSms(tx, {
    partnerId,
    storeId: null,
    idempotencyKey: `verification_code:${id}`,
    payload: { message: purpose === 'sign_in' ? 'code.second_factor' : 'code.verify_phone', to: phone, brand: await brandName(tx, partnerId, now), vars: { code }, expiresAt: expiresAt.toISOString() },
  })
}

/** Checks a texted code: the latest live one, five tries, used once. */
export const checkTextedCode = async (tx: ScopedSql, userId: string, purpose: 'sign_in' | 'enrol_phone', typed: string, now: Date): Promise<'ok' | 'wrong' | 'expired'> => {
  const live = await selectLiveCode(tx, userId, purpose, now)
  if (!live || live.attempts >= maxSmsCodeAttempts) return 'expired'
  if (!codeMatches((await hashSmsCode(live.id, typed)) === live.code_hash)) {
    await bumpCodeAttempt(tx, live.id)
    return 'wrong'
  }
  return (await markCodeUsed(tx, live.id, now)) ? 'ok' : 'expired'
}

/** Wrong passwords and codes share one count; the fifth pauses sign-in for 15 minutes and emails the person (FIRST-RELEASE §4). */
export const countWrong = async (tx: ScopedSql, activity: ActivityLog, facts: RequestFacts, person: { id: string; partner_id: string; email: string }, now: Date): Promise<{ triesLeft: number; locked: boolean }> => {
  const lockedUntil = new Date(now.getTime() + lockMs)
  const counted = await recordUserWrongCode(tx, person.id, maxCodeTries, lockedUntil)
  if (!counted.locked) return counted
  await activity.record(tx, personLocked({ id: person.id, partnerId: person.partner_id }, facts))
  await queueSideEffect(tx, {
    kind: 'email',
    idempotencyKey: `user-locked:${person.id}:${lockedUntil.toISOString()}`,
    payload: { template: 'user-locked', userId: person.id, to: person.email, minutes: lockMs / 60_000 },
    partnerId: person.partner_id,
    storeId: null,
  })
  return counted
}
