import { z } from 'zod'
import { personJoinedStore, personPasswordReset, type RequestFacts } from '#auth/activity'
import { hashPassword, minPasswordLength } from '#auth/password'
import { hashSessionId } from '#auth/session'
import { holdForEnrolment, readUserSession, setStoreCookie } from '#auth/storeSession'
import { userPasswordResetRequestKind } from '#auth/storeTokens'
import { withSystemScope } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import {
  acceptAsExistingPerson,
  acceptAsNewPerson,
  resetUserPassword,
  selectStoreInvitationByToken,
  selectUserResetByToken,
  type StoreInvitationByToken,
} from '#db/scoped/userInvitations'
import { selectSignInCandidate, selectUserSecondFactor } from '#db/scoped/userSignIn'
import { admit, admitted, type Admission, type StoreAuthDeps } from './admission'
import { json, readBody, refuse, type Refusal } from './authHttp'

// Store invitations (`/accept-invite` for a new person, `/join` for an existing account) and
// password reset on a partner's portal host (ACCESS.md §4, §6; FIRST-RELEASE §4; #290).

const tokenInput = z.strictObject({ token: z.string().min(1).max(200) })
const acceptInput = z.strictObject({ token: z.string().min(1).max(200), name: z.string().max(120), password: z.string().max(1024) })
const resetRequestInput = z.strictObject({ email: z.string().max(320) })
const resetInput = z.strictObject({ token: z.string().min(1).max(200), password: z.string().max(1024) })

/** Why a link no longer works (ACCESS.md §6.3); one refusal for unknown, revoked or closed, so it reveals nothing. */
const closedAs = (i: StoreInvitationByToken, now: Date): Refusal | null => {
  if (i.accepted_at) return { code: 'INVITATION_USED' }
  if (i.revoked_at) return { code: i.replaced ? 'INVITATION_REPLACED' : 'INVITATION_INVALID' }
  if (!i.user_id || (i.user_status !== 'invited' && i.user_status !== 'active') || i.store_status === 'closed') return { code: 'INVITATION_INVALID' }
  if (i.expires_at <= now) return { code: 'INVITATION_EXPIRED', invitedBy: i.invited_by_label }
  return null
}

const findOpen = async (tx: Parameters<typeof selectStoreInvitationByToken>[0], deps: StoreAuthDeps, token: string, now: Date): Promise<Refusal | StoreInvitationByToken> => {
  const found = await selectStoreInvitationByToken(tx, deps.partnerId, await hashSessionId(token))
  if (!found) return { code: 'INVITATION_INVALID' }
  return closedAs(found, now) ?? found
}

const isRefusal = (value: Refusal | StoreInvitationByToken): value is Refusal => 'code' in value

/** What the invite screen shows before anything is set: the store, the role, the address, and which path. */
export const lookUpStoreInvitation = async (request: Request, deps: StoreAuthDeps): Promise<Response> => {
  const input = await readBody(request, tokenInput)
  if (!input) return refuse({ code: 'INVITATION_INVALID' })
  const outcome = await withSystemScope(deps.sql, (tx) => findOpen(tx, deps, input.token, deps.now()))
  if (isRefusal(outcome)) return refuse(outcome)
  return json(200, {
    ok: true,
    invitation: {
      store: outcome.store_name,
      role: outcome.role_key,
      supplier: outcome.seller_name,
      email: outcome.email,
      invitedBy: outcome.invited_by_label,
      path: outcome.user_status === 'invited' ? 'new' : 'join',
    },
  })
}

/** A new person sets a name and a password; the session opens as sign-in would (an Owner enrols first). */
export const acceptStoreInvitation = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, acceptInput)
  if (!input) return refuse({ code: 'INVITATION_INVALID' })
  const name = input.name.trim()
  if (name === '') return refuse({ code: 'NAME_REQUIRED' })
  if (input.password.length < minPasswordLength) return refuse({ code: 'WEAK_PASSWORD' })
  const passwordHash = await hashPassword(input.password)
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | Admission> => {
    const found = await findOpen(tx, deps, input.token, now)
    if (isRefusal(found)) return found
    // The existing account's path is /join: a password here would change an account without its owner.
    if (found.user_status !== 'invited' || !found.user_id) return { code: 'INVITATION_INVALID' }
    const userId = found.user_id
    if (!(await acceptAsNewPerson(tx, found, userId, name, passwordHash, now))) return { code: 'INVITATION_INVALID' }
    await deps.activity.record(tx, personJoinedStore({ id: userId, partnerId: deps.partnerId }, facts, { id: found.store_id, name: found.store_name }, found.seller_id, found.role_key))
    const candidate = await selectSignInCandidate(tx, deps.partnerId, found.email)
    if (!candidate) return { code: 'INVITATION_INVALID' }
    return admit(tx, deps, facts, candidate, false, now)
  })
  return 'code' in outcome ? refuse(outcome) : admitted(outcome)
}

/** An existing account, signed in on this host, joins without any change to it (ACCESS.md §6.2). */
export const joinStore = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, tokenInput)
  if (!input) return refuse({ code: 'INVITATION_INVALID' })
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | { enrol: boolean }> => {
    const session = cookie ? await readUserSession(tx, cookie, deps.partnerId, now) : null
    if (!cookie || !session) return { code: 'INVALID_CREDENTIALS' }
    const found = await findOpen(tx, deps, input.token, now)
    if (isRefusal(found)) return found
    // Someone else's link reads as any other bad link: it never says whose it is.
    if (found.user_id !== session.userId || found.user_status !== 'active') return { code: 'INVITATION_INVALID' }
    if (!(await acceptAsExistingPerson(tx, found, session.userId, now))) return { code: 'INVITATION_INVALID' }
    await deps.activity.record(tx, personJoinedStore({ id: session.userId, partnerId: deps.partnerId }, facts, { id: found.store_id, name: found.store_name }, found.seller_id, found.role_key))
    const state = await selectUserSecondFactor(tx, session.userId)
    const enrol = !!state && state.is_owner && state.two_factor_method === null
    if (enrol) await holdForEnrolment(tx, cookie, now)
    return { enrol }
  })
  if ('code' in outcome) return refuse(outcome)
  if (!outcome.enrol || !cookie) return json(200, { ok: true, step: 'done' })
  return json(200, { ok: true, step: 'enrol' }, setStoreCookie(cookie, false, 'enrol'))
}

// The same answer, and the same single write, whether or not the email has an account here
// (ACCESS.md §2, §4): the relay finds it (jobs/queues/deliverers/userPasswordReset.ts).
export const requestStorePasswordReset = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, resetRequestInput)
  if (input && !(await deps.allowAttempt(`store:${deps.host}:reset:${input.email.trim().toLowerCase()}`))) return refuse({ code: 'RATE_LIMITED' })
  if (input) {
    await withSystemScope(deps.sql, (tx) =>
      insertOutbox(tx, {
        kind: userPasswordResetRequestKind,
        idempotencyKey: crypto.randomUUID(),
        payload: { email: input.email.trim(), requestedAt: deps.now().toISOString(), ...facts },
        partnerId: deps.partnerId,
        storeId: null,
      }),
    )
  }
  return json(200, { ok: true })
}

/** Works once within 30 minutes; ends every session of the person, then signs in here as far as 2-factor allows. */
export const resetStorePassword = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, resetInput)
  if (!input) return refuse({ code: 'RESET_INVALID' })
  if (input.password.length < minPasswordLength) return refuse({ code: 'WEAK_PASSWORD' })
  const tokenHash = await hashSessionId(input.token)
  const passwordHash = await hashPassword(input.password)
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | Admission> => {
    const reset = await selectUserResetByToken(tx, deps.partnerId, tokenHash, now)
    if (!reset) return { code: 'RESET_INVALID' }
    await resetUserPassword(tx, reset.user_id, passwordHash, now)
    await deps.activity.record(tx, personPasswordReset({ id: reset.user_id, partnerId: deps.partnerId }, facts))
    const candidate = await selectSignInCandidate(tx, deps.partnerId, reset.email)
    if (!candidate) return { code: 'RESET_INVALID' }
    return admit(tx, deps, facts, candidate, false, now)
  })
  return 'code' in outcome ? refuse(outcome) : admitted(outcome)
}
