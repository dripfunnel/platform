import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { StoreCaller } from '#auth/storeCaller'
import type { PageWindow } from '#core/paging'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  countInvitationsSince,
  countOtherOwners,
  countPeople,
  countStaffSeats,
  holdInvitedMembership,
  insertInvitation,
  invitee,
  isMemberHere,
  lockStorePeople,
  openInvitationTo,
  removeMember,
  revokeInvitation,
  selectMember,
  selectOpenInvitation,
  selectPeople,
  setMemberRole,
  type MerchantRole,
} from '#db/scoped/people'
import { allowanceFor, planLimitFor, type PlanLimit } from '#saas/entitlements/index'
import { queueSideEffect } from '#saas/outbox/index'
import { selectKeysMadeBy } from '#db/scoped/apiKeys'
import { hashSessionId } from '#auth/session'
import { isUuid } from '#core/ids'

// Settings › People (ACCESS.md §6, SetTeam): the store's merchant side. Every write takes the store's
// People lock, so a staff seat counted (SAAS.md §6.2) or an Owner kept is still so when it commits.

export const peopleAudit = {
  inviteMember: 'member.invited',
  resendInvitation: 'member.invitation_resent',
  revokeInvitation: 'member.invitation_revoked',
  changeRole: 'member.role_changed',
  removeMember: 'member.removed',
} as const

export type PeopleRefusal =
  | { reason: 'ALREADY_MEMBER' | 'NOT_FOUND' | 'LAST_OWNER' | 'INVALID_EMAIL' | 'INVALID_INPUT' }
  | { reason: 'RATE_LIMITED'; per: 'inviter' | 'address' }
  | { reason: 'PLAN_LIMIT'; limit: PlanLimit }

export type PeopleResult = { ok: true } | ({ ok: false } & PeopleRefusal)

const invitationDays = 7
const day = 24 * 60 * 60 * 1000
// As the partner console's team (#199): per inviter an hour, per address a day.
export const perInviterPerHour = 20
export const perAddressPerDay = 3


export const merchantRoleOf = (value: string): MerchantRole | null => (value === 'owner' || value === 'manager' || value === 'staff' ? value : null)

export const normalisedEmail = (value: string): string | null => {
  const email = value.trim()
  return email.length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null
}

export interface StorePeopleDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

type Write = { ok: true } | { ok: false; refusal: PeopleRefusal } | { ok: false; seatsWanted: number }

export const createStorePeopleService = ({ sql, caller, activity, facts, now }: StorePeopleDeps) => {
  const storeId = caller.store.id
  const inStore = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, caller.context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    target,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  /** A seat refusal names the plan that unlocks it, read after the locked transaction: that read needs system scope. */
  const settle = async (write: Write): Promise<PeopleResult> => {
    if (write.ok) return { ok: true }
    if ('refusal' in write) return { ok: false, ...write.refusal }
    const limit = await planLimitFor(sql, caller.context, { key: 'staff', total: write.seatsWanted }, now())
    return limit ? { ok: false, reason: 'PLAN_LIMIT', limit } : { ok: false, reason: 'PLAN_LIMIT', limit: { key: 'staff', limit: 0, unlockedBy: null } }
  }

  // Only an Owner makes keys; theirs keep working when they go, and the Owners left are told (decided on #337).
  // Once per person and set of keys: told about the same keys before, the Owners aren't told again.
  const tellOwnersOfKeys = async (tx: ScopedSql, member: { id: string; user_id: string }) => {
    const keys = await selectKeysMadeBy(tx, storeId, member.user_id, now())
    if (keys.length === 0) return
    const digest = await hashSessionId(keys.join(','))
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `api-keys-creator-gone:${member.id}:${digest}`, payload: { template: 'api-keys-creator-gone', storeId, creatorId: member.user_id, keys: keys.length }, partnerId: caller.person.partnerId, storeId })
  }

  const seatsFor = (tx: ScopedSql, exceptInvitationId: string | null) => countStaffSeats(tx, storeId, exceptInvitationId)

  /** The invitation and its email, after the limits; a suspended or deleted account gets the same answer and no email. */
  const sendInvitation = async (tx: ScopedSql, email: string, role: MerchantRole, replacing: string | null): Promise<PeopleRefusal | string> => {
    const at = now()
    if ((await countInvitationsSince(tx, storeId, new Date(at.getTime() - 60 * 60 * 1000), { inviterId: caller.person.id })) >= perInviterPerHour) return { reason: 'RATE_LIMITED', per: 'inviter' }
    if ((await countInvitationsSince(tx, storeId, new Date(at.getTime() - day), { email })) >= perAddressPerDay) return { reason: 'RATE_LIMITED', per: 'address' }
    if (replacing) await revokeInvitation(tx, replacing, at)
    const userId = await invitee(tx, email, email.split('@')[0] ?? email)
    if (userId) await holdInvitedMembership(tx, storeId, userId, role, caller.person.id)
    const invitationId = await insertInvitation(tx, { storeId, email, role, expiresAt: new Date(at.getTime() + invitationDays * day), invitedBy: { id: caller.person.id, label: caller.person.name }, now: at })
    if (userId) await queueSideEffect(tx, { kind: 'email', idempotencyKey: `store-invitation:${invitationId}`, payload: { template: 'store-owner-invitation', invitationId, to: email, storeId }, partnerId: caller.person.partnerId, storeId })
    return invitationId
  }

  const list = (filter: 'all' | 'staff' | 'waiting', window: PageWindow) => inStore((tx) => selectPeople(tx, storeId, filter, window))

  const counts = () => inStore((tx) => countPeople(tx, storeId))

  const invite = async (rawEmail: string, rawRole: string): Promise<PeopleResult> => {
    const email = normalisedEmail(rawEmail)
    const role = merchantRoleOf(rawRole)
    if (!email) return { ok: false, reason: 'INVALID_EMAIL' }
    if (!role) return { ok: false, reason: 'INVALID_INPUT' }
    const allowance = role === 'owner' ? null : await allowanceFor(sql, caller.context, 'staff', now())
    return settle(
      await inStore(async (tx): Promise<Write> => {
        await lockStorePeople(tx, storeId)
        // "Already a member here" comes first: it is the only refusal about the person (ACCESS.md §6.3).
        if (await isMemberHere(tx, storeId, email)) return { ok: false, refusal: { reason: 'ALREADY_MEMBER' } }
        const replacing = await openInvitationTo(tx, storeId, email)
        if (allowance !== null) {
          const wanted = (await seatsFor(tx, replacing)) + 1
          if (wanted > allowance) return { ok: false, seatsWanted: wanted }
        }
        const sent = await sendInvitation(tx, email, role, replacing)
        if (typeof sent !== 'string') return { ok: false, refusal: sent }
        await activity.record(tx, entry(peopleAudit.inviteMember, { type: 'invitation', id: sent, label: email }, role))
        return { ok: true }
      }),
    )
  }

  const resend = async (invitationId: string): Promise<PeopleResult> => {
    if (!isUuid(invitationId)) return { ok: false, reason: 'NOT_FOUND' }
    return settle(
      await inStore(async (tx): Promise<Write> => {
        await lockStorePeople(tx, storeId)
        const open = await selectOpenInvitation(tx, invitationId)
        if (!open) return { ok: false, refusal: { reason: 'NOT_FOUND' } }
        // A new link replaces the old (ACCESS.md §6.3) and takes the seat it frees, so no seat check.
        const sent = await sendInvitation(tx, open.email, open.role_key, open.id)
        if (typeof sent !== 'string') return { ok: false, refusal: sent }
        await activity.record(tx, entry(peopleAudit.resendInvitation, { type: 'invitation', id: sent, label: open.email }, null))
        return { ok: true }
      }),
    )
  }

  const revoke = async (invitationId: string): Promise<PeopleResult> => {
    if (!isUuid(invitationId)) return { ok: false, reason: 'NOT_FOUND' }
    return settle(
      await inStore(async (tx): Promise<Write> => {
        await lockStorePeople(tx, storeId)
        const open = await selectOpenInvitation(tx, invitationId)
        if (!open) return { ok: false, refusal: { reason: 'NOT_FOUND' } }
        await revokeInvitation(tx, open.id, now())
        await activity.record(tx, entry(peopleAudit.revokeInvitation, { type: 'invitation', id: open.id, label: open.email }, null))
        return { ok: true }
      }),
    )
  }

  const changeRole = async (membershipId: string, rawRole: string): Promise<PeopleResult> => {
    const role = merchantRoleOf(rawRole)
    if (!role) return { ok: false, reason: 'INVALID_INPUT' }
    if (!isUuid(membershipId)) return { ok: false, reason: 'NOT_FOUND' }
    const allowance = role === 'owner' ? null : await allowanceFor(sql, caller.context, 'staff', now())
    return settle(
      await inStore(async (tx): Promise<Write> => {
        await lockStorePeople(tx, storeId)
        const member = await selectMember(tx, membershipId)
        if (!member) return { ok: false, refusal: { reason: 'NOT_FOUND' } }
        if (member.role_key === role) return { ok: true }
        if (member.role_key === 'owner') {
          if ((await countOtherOwners(tx, storeId, member.id)) === 0) return { ok: false, refusal: { reason: 'LAST_OWNER' } }
          // An Owner becoming a Manager or Staff takes a seat.
          const wanted = (await seatsFor(tx, null)) + 1
          if (allowance !== null && wanted > allowance) return { ok: false, seatsWanted: wanted }
        }
        await setMemberRole(tx, member.id, role)
        if (member.role_key === 'owner') await tellOwnersOfKeys(tx, member)
        await activity.record(tx, { ...entry(peopleAudit.changeRole, { type: 'membership', id: member.id, label: member.label }, null), changes: [{ field: 'role', before: member.role_key, after: role }] })
        return { ok: true }
      }),
    )
  }

  const remove = async (membershipId: string): Promise<PeopleResult> => {
    if (!isUuid(membershipId)) return { ok: false, reason: 'NOT_FOUND' }
    return settle(
      await inStore(async (tx): Promise<Write> => {
        await lockStorePeople(tx, storeId)
        const member = await selectMember(tx, membershipId)
        if (!member) return { ok: false, refusal: { reason: 'NOT_FOUND' } }
        if (member.role_key === 'owner' && (await countOtherOwners(tx, storeId, member.id)) === 0) return { ok: false, refusal: { reason: 'LAST_OWNER' } }
        await removeMember(tx, member.id)
        if (member.role_key === 'owner') await tellOwnersOfKeys(tx, member)
        await activity.record(tx, entry(peopleAudit.removeMember, { type: 'membership', id: member.id, label: member.label }, null))
        return { ok: true }
      }),
    )
  }

  return { list, counts, invite, resend, revoke, changeRole, remove }
}
