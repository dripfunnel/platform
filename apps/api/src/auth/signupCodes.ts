import type { ScopedSql } from '#db/scoped/index'
import { setSignupEmailCode } from '#db/scoped/signup'
import { hashSmsCode, newSmsCode, smsCodeMs } from './storeCodes'

/** The sign-up email's code, made when the email is sent so none rests in the outbox (ACCESS.md §6.1); null once past that step. */
export const mintSignupEmailCode = async (tx: ScopedSql, signupId: string, now: Date): Promise<string | null> => {
  const code = newSmsCode()
  return (await setSignupEmailCode(tx, signupId, await hashSmsCode(`signup-email:${signupId}`, code), new Date(now.getTime() + smsCodeMs))) ? code : null
}
