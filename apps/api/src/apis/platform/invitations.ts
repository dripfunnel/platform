import { z } from 'zod'
import { partnerInvitationAccepted, partnerPasswordReset, partnerSignedIn, type RequestFacts } from '#auth/activity'
import { hashPassword, minPasswordLength } from '#auth/password'
import { completePartnerSession, createPartnerSession, readPendingSession, setPartnerCookie } from '#auth/partnerSession'
import { passwordResetRequestKind } from '#auth/partnerTokens'
import { hashSessionId } from '#auth/session'
import { withSystemScope } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { acceptInvitation, resetPassword, selectInvitationByToken, selectResetByToken, type InvitationByToken } from '#db/scoped/partnerInvitations'
import { markPartnerSignedIn, selectSecondFactorPolicy } from '#db/scoped/partnerUsers'
import { json, readBody, refuse, type Refusal } from './authHttp'
import type { PlatformAuthDeps } from './auth'

// Accepting an invitation and resetting a password (ui/platform/FIRST-RELEASE.md §3, ACCESS.md
// §4, §6; card #208). The token is looked up by its hash and never logged.

const tokenInput = z.strictObject({ token: z.string().min(1).max(200) })
const acceptInput = z.strictObject({ token: z.string().min(1).max(200), name: z.string().max(120), password: z.string().max(1024) })
const resetRequestInput = z.strictObject({ email: z.string().max(320) })
const resetInput = z.strictObject({ token: z.string().min(1).max(200), password: z.string().max(1024) })

const strong = (password: string) => password.length >= minPasswordLength

/** Why an invitation's link no longer works, in ACCESS.md §6.3's terms; null while it does. */
const closedAs = (i: InvitationByToken, now: Date): Refusal | null => {
  if (i.accepted_at) return { code: 'INVITATION_USED' }
  if (i.revoked_at) return { code: i.replaced ? 'INVITATION_REPLACED' : 'INVITATION_INVALID' }
  if (i.user_status !== 'invited' || i.partner_state === 'closed') return { code: 'INVITATION_INVALID' }
  if (!i.expires_at || i.expires_at <= now) return { code: 'INVITATION_EXPIRED' }
  return null
}

const invitationOf = (i: InvitationByToken) => ({
  partner: i.partner_name,
  role: i.role_key,
  email: i.email,
  // FIRST-RELEASE §3: DripFunnel for the Owner's invitation, the inviter by name otherwise.
  invitedBy: i.invited_by_kind === 'staff' ? 'DripFunnel' : i.invited_by_label,
  secondFactorRequired: i.second_factor_required,
})

export const lookUpInvitation = async (request: Request, deps: PlatformAuthDeps): Promise<Response> => {
  const input = await readBody(request, tokenInput)
  if (!input) return refuse({ code: 'INVITATION_INVALID' })
  const tokenHash = await hashSessionId(input.token)
  const outcome = await withSystemScope(deps.sql, async (tx) => {
    const found = await selectInvitationByToken(tx, tokenHash)
    if (!found) return { code: 'INVITATION_INVALID' } as const
    return closedAs(found, deps.now()) ?? invitationOf(found)
  })
  return 'code' in outcome ? refuse(outcome) : json(200, { ok: true, invitation: outcome })
}

// Accepting always opens an `enrol` session: step 2 of 2 sets up 2-factor, or skips it when the
// partner allows (skip-second-factor), so the requirement is the partner's, never the request's.
export const acceptPartnerInvitation = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, acceptInput)
  if (!input) return refuse({ code: 'INVITATION_INVALID' })
  const name = input.name.trim()
  if (name === '') return refuse({ code: 'NAME_REQUIRED' })
  if (!strong(input.password)) return refuse({ code: 'WEAK_PASSWORD' })
  const tokenHash = await hashSessionId(input.token)
  const passwordHash = await hashPassword(input.password)
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | { session: string; secondFactorRequired: boolean }> => {
    const found = await selectInvitationByToken(tx, tokenHash)
    if (!found) return { code: 'INVITATION_INVALID' }
    const closed = closedAs(found, now)
    if (closed) return closed
    await acceptInvitation(tx, { id: found.id, partnerUserId: found.partner_user_id }, name, passwordHash, now)
    await deps.activity.record(tx, partnerInvitationAccepted({ id: found.partner_user_id, partnerId: found.partner_id }, facts))
    return { session: await createPartnerSession(tx, found.partner_user_id, now, 'enrol'), secondFactorRequired: found.second_factor_required }
  })
  if ('code' in outcome) return refuse(outcome)
  return json(200, { ok: true, step: 'enrol', secondFactorRequired: outcome.secondFactorRequired }, setPartnerCookie(outcome.session))
}

export const skipSecondFactor = async (deps: PlatformAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | null> => {
    const pending = cookie ? await readPendingSession(tx, cookie, 'enrol', now) : null
    if (!cookie || !pending) return { code: 'INVALID_CREDENTIALS' }
    const row = await selectSecondFactorPolicy(tx, pending.partnerUserId)
    if (!row) return { code: 'INVALID_CREDENTIALS' }
    if (row.required) return { code: 'SECOND_FACTOR_REQUIRED' }
    await markPartnerSignedIn(tx, pending.partnerUserId, now)
    await completePartnerSession(tx, cookie, now)
    await deps.activity.record(tx, partnerSignedIn({ id: pending.partnerUserId, partnerId: row.partner_id }, facts))
    return null
  })
  return outcome ? refuse(outcome) : json(200, { ok: true })
}

// The same answer, and the same single write, whether or not the email has an account
// (FIRST-RELEASE §3, ACCESS.md §2, §4): the relay finds the accounts (jobs/queues/deliverers/partnerPasswordReset.ts).
export const requestPasswordReset = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, resetRequestInput)
  if (input && !(await deps.allowAttempt(`reset:${input.email.trim().toLowerCase()}`))) return refuse({ code: 'RATE_LIMITED' })
  if (input) {
    await withSystemScope(deps.sql, (tx) =>
      insertOutbox(tx, {
        kind: passwordResetRequestKind,
        idempotencyKey: crypto.randomUUID(),
        payload: { email: input.email.trim(), requestedAt: deps.now().toISOString(), ...facts },
        partnerId: null,
        storeId: null,
      }),
    )
  }
  return json(200, { ok: true })
}

export const resetPartnerPassword = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, resetInput)
  if (!input) return refuse({ code: 'RESET_INVALID' })
  if (!strong(input.password)) return refuse({ code: 'WEAK_PASSWORD' })
  const tokenHash = await hashSessionId(input.token)
  const passwordHash = await hashPassword(input.password)
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | null> => {
    const reset = await selectResetByToken(tx, tokenHash, now)
    if (!reset) return { code: 'RESET_INVALID' }
    await resetPassword(tx, reset.partner_user_id, passwordHash, now)
    await deps.activity.record(tx, partnerPasswordReset({ id: reset.partner_user_id, partnerId: reset.partner_id }, facts))
    return null
  })
  return outcome ? refuse(outcome) : json(200, { ok: true })
}
