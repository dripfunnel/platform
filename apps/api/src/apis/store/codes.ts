import {
  chooseCodeChannel,
  hashSmsCode,
  maxSmsCodeAttempts,
  maxSmsCodesPer10Min,
  newSmsCode,
  phoneHint,
  smsCodeMs,
  type ChannelRefusal,
  type CodeChannel,
  type OpenCodeChannels,
} from '#auth/storeCodes'
import { codeMatches, type CodeCheck } from '#auth/codeCheck'
import { personCodeSent, personLocked, type ActivityLog, type RequestFacts } from '#auth/activity'
import { lockMs, maxCodeTries } from '#auth/partnerCode'
import type { ScopedSql } from '#db/scoped/index'
import { selectPortalBrand } from '#db/scoped/portalBrand'
import { bumpCodeAttempt, countCodesSince, insertVerificationCode, markCodeUsed, recordUserWrongCode, selectLastCodeSent, selectLiveCode } from '#db/scoped/userSignIn'
import { queueSideEffect } from '#saas/outbox/index'
import { queuePortalCode, type CodeChannelCheck } from '#saas/portalCodes/index'

// Portal codes by WhatsApp or SMS, the brand they're sent in, and the one wrong-try count, for sign-in, enrolment and My
// profile (ACCESS.md §4).

/** The partner's brand name: the authenticator's issuer and the sender of every text (white label). */
export const brandName = async (tx: ScopedSql, partnerId: string, now: Date): Promise<string> => {
  const brand = await selectPortalBrand(tx, partnerId, now)
  if (!brand) throw new Error('store auth: the host resolved to a partner with no brand row')
  return (brand.product_name ?? brand.partner_name).slice(0, 30)
}

export type SendRefusal = ChannelRefusal | { code: 'RATE_LIMITED' }
export interface CodeSent {
  hint: string
  channel: CodeChannel
  codeChannels: OpenCodeChannels
}

/**
 * The one send for a person's code (ACCESS.md §4, #1506): the channel asked for or the default, the 20 s before SMS
 * after WhatsApp, and three sends in 10 minutes across both. The newest code is the only one accepted.
 */
export const sendPersonCode = async (
  tx: ScopedSql,
  deps: { codeChannels: CodeChannelCheck; activity: ActivityLog; facts: RequestFacts },
  person: { id: string; partnerId: string; phone: string },
  purpose: 'sign_in' | 'enrol_phone',
  asked: CodeChannel | undefined,
  now: Date,
): Promise<SendRefusal | CodeSent> => {
  const open = await deps.codeChannels.forPartner(tx, person.partnerId, person.phone)
  const channel = chooseCodeChannel(asked, open, await selectLastCodeSent(tx, person.id, purpose), now)
  if (typeof channel !== 'string') return channel
  if ((await countCodesSince(tx, person.id, new Date(now.getTime() - 10 * 60_000))) >= maxSmsCodesPer10Min) return { code: 'RATE_LIMITED' }
  const id = crypto.randomUUID()
  const code = newSmsCode()
  const expiresAt = new Date(now.getTime() + smsCodeMs)
  await insertVerificationCode(tx, { id, partnerId: person.partnerId, userId: person.id, purpose, channel, hash: await hashSmsCode(id, code), expiresAt, createdAt: now })
  await queuePortalCode(tx, {
    partnerId: person.partnerId,
    channel,
    to: person.phone,
    purpose: purpose === 'sign_in' ? 'sign_in' : 'verify_phone',
    code,
    expiresAt,
    brand: () => brandName(tx, person.partnerId, now),
    idempotencyKey: `verification_code:${id}`,
  })
  await deps.activity.record(tx, personCodeSent({ id: person.id, partnerId: person.partnerId }, deps.facts, channel))
  return { hint: phoneHint(person.phone), channel, codeChannels: open }
}

/** Checks a sent code: the latest live one, whichever channel it went by, five tries, used once. */
export const checkTextedCode = async (tx: ScopedSql, userId: string, purpose: 'sign_in' | 'enrol_phone', typed: string, now: Date, mode: CodeCheck): Promise<'ok' | 'wrong' | 'expired'> => {
  const live = await selectLiveCode(tx, userId, purpose, now)
  if (!live || live.attempts >= maxSmsCodeAttempts) return 'expired'
  if (!codeMatches((await hashSmsCode(live.id, typed)) === live.code_hash, mode, 'text')) {
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
