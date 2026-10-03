import type { ScopedSql } from '#db/scoped/index'
import { issueInvitationToken, issueResetToken } from '#db/scoped/partnerInvitations'
import { hashSessionId, newSessionId } from './session'

// The links' tokens, minted when the email is sent so no secret rests in the outbox (ACCESS.md
// §6.1); 32 random bytes, stored only as a hash. The email deliverer calls these (system scope).

export const resetValidMs = 30 * 60 * 1000

/** The token for an open invitation's link, or null when it is no longer open; a new one replaces the last. */
export const mintInvitationToken = async (tx: ScopedSql, invitationId: string, now: Date): Promise<string | null> => {
  const token = newSessionId()
  return (await issueInvitationToken(tx, invitationId, await hashSessionId(token), now)) ? token : null
}

/** The token for a reset's link, valid 30 minutes from now; null once the reset is used or already sent. */
export const mintResetToken = async (tx: ScopedSql, resetId: string, now: Date): Promise<string | null> => {
  const token = newSessionId()
  return (await issueResetToken(tx, resetId, await hashSessionId(token), now, resetValidMs)) ? token : null
}
