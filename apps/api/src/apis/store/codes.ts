import { hashSmsCode, maxSmsCodeAttempts, newSmsCode, smsCodeMs } from '#auth/storeCodes'
import type { ScopedSql } from '#db/scoped/index'
import { selectPortalBrand } from '#db/scoped/portalBrand'
import { bumpCodeAttempt, insertVerificationCode, markCodeUsed, selectLiveCode } from '#db/scoped/userSignIn'
import { queueSms } from '#saas/sms/index'

// Texted codes and the brand they're sent in, for sign-in, enrolment and My profile (ACCESS.md §4).

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
  if ((await hashSmsCode(live.id, typed)) !== live.code_hash) {
    await bumpCodeAttempt(tx, live.id)
    return 'wrong'
  }
  return (await markCodeUsed(tx, live.id, now)) ? 'ok' : 'expired'
}
