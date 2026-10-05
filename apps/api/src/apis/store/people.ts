import { GraphQLError } from 'graphql'
import type { ActivityEntry } from '#auth/activity'
import { pageOf } from '#core/paging'
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
  openInvitationTo,
  removeMember,
  revokeInvitation,
  selectMember,
  selectOpenInvitation,
  selectPeople,
  setMemberRole,
  type MerchantRole,
  type PersonRow,
} from '#db/scoped/people'
import { queueSideEffect } from '#saas/outbox/index'
import { planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › People (ACCESS.md §6, SetTeam): the store's merchant side, Owner only (`invite`). Every
// read and write runs in the acting store's scope; supplier users are SAPI 5's.

const refused = (code: string, message: string, extensions: Record<string, unknown> = {}) => new GraphQLError(message, { extensions: { code, ...extensions } })

const invitationDays = 7
const day = 24 * 60 * 60 * 1000
// As the partner console's team (#199): per inviter an hour, per address a day.
const perInviterPerHour = 20
const perAddressPerDay = 3

const roleOf = (value: string): MerchantRole => {
  if (value === 'owner' || value === 'manager' || value === 'staff') return value
  throw refused('INVALID_INPUT', 'Choose Owner, Manager or Staff.')
}

const emailOf = (value: string): string => {
  const email = value.trim()
  if (email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw refused('INVALID_EMAIL', 'That doesn’t look like an email address.')
  return email
}

interface PersonView {
  id: string
  kind: 'member' | 'invitation'
  name: string | null
  email: string
  role: MerchantRole
  you: boolean
  since: string
  expiresAt: string | null
  expired: boolean
}

export const registerPeople = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const PersonType = builder.objectRef<PersonView>('StorePerson').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // A member's id is the membership's, an invitation's the invitation's: each mutation names which it takes.
      kind: t.exposeString('kind'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email'),
      role: t.exposeString('role'),
      you: t.exposeBoolean('you'),
      since: t.exposeString('since'),
      expiresAt: t.exposeString('expiresAt', { nullable: true }),
      expired: t.exposeBoolean('expired'),
    }),
  })
  const PeoplePage = builder.objectRef<{ nodes: PersonView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StorePeople').implement({
    fields: (t) => ({ nodes: t.field({ type: [PersonType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<{ staff: number; waiting: number }>('StorePeopleCounts').implement({
    fields: (t) => ({ staff: t.exposeInt('staff'), waiting: t.exposeInt('waiting') }),
  })

  const access = { api: 'store', scope: 'store', permission: 'invite', target: 'none' } as const
  const sqlOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return ctx.sql
  }

  const viewOf = (r: PersonRow, youId: string, now: Date): PersonView => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    email: r.email,
    role: r.role_key,
    you: r.user_id === youId,
    since: r.sort_at.toISOString(),
    expiresAt: r.expires_at?.toISOString() ?? null,
    expired: r.expires_at !== null && r.expires_at <= now,
  })

  builder.queryFields((t) => ({
    people: t.field({
      type: PeoplePage,
      args: { filter: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        const filter = args.filter === 'staff' || args.filter === 'waiting' ? args.filter : 'all'
        const window = storePage(args)
        const rows = await withScope(sqlOf(ctx), caller.context, (tx) => selectPeople(tx, caller.store.id, filter, window))
        const page = pageOf(rows, window, (r) => ({ occurredAt: r.sort_at, id: r.id }))
        return { nodes: page.nodes.map((r) => viewOf(r, caller.person.id, ctx.now())), pageInfo: page.pageInfo }
      },
    }),
    peopleCounts: t.field({
      type: Counts,
      extensions: { access },
      resolve: async (_, __, ctx) => {
        const caller = actingCaller(ctx)
        return withScope(sqlOf(ctx), caller.context, (tx) => countPeople(tx, caller.store.id))
      },
    }),
  }))

  const entry = (ctx: StoreContext, action: string, target: { type: string; id: string; label: string }, reason: string | null): ActivityEntry => {
    const caller = actingCaller(ctx)
    return { category: 'write', action, result: 'success', actorKind: 'person', actorId: caller.person.id, actorLabel: null, partnerId: caller.person.partnerId, storeId: caller.store.id, target, reason, api: 'store', visibility: 'store', ...ctx.facts }
  }

  /** The invitation, its email, and the plan's seat check for a Manager or Staff (SAAS.md §6.2). */
  const sendInvitation = async (tx: ScopedSql, ctx: StoreContext, email: string, role: MerchantRole, replacing: string | null): Promise<string> => {
    const caller = actingCaller(ctx)
    const now = ctx.now()
    if ((await countInvitationsSince(tx, caller.store.id, new Date(now.getTime() - 60 * 60 * 1000), { inviterId: caller.person.id })) >= perInviterPerHour) throw refused('RATE_LIMITED', 'Too many invitations for now. Try again in an hour.')
    if ((await countInvitationsSince(tx, caller.store.id, new Date(now.getTime() - day), { email })) >= perAddressPerDay) throw refused('RATE_LIMITED', 'That address has had enough invitations today.')
    if (replacing) await revokeInvitation(tx, replacing, now)
    const userId = await invitee(tx, email, email.split('@')[0] ?? email)
    if (userId) await holdInvitedMembership(tx, caller.store.id, userId, role, caller.person.id)
    const invitationId = await insertInvitation(tx, { storeId: caller.store.id, email, role, expiresAt: new Date(now.getTime() + invitationDays * day), invitedBy: { id: caller.person.id, label: caller.person.name }, now })
    // A suspended or deleted account can't accept: the invitation is recorded the same, and no email goes.
    if (userId) await queueSideEffect(tx, { kind: 'email', idempotencyKey: `store-invitation:${invitationId}`, payload: { template: 'store-owner-invitation', invitationId, to: email, storeId: caller.store.id }, partnerId: caller.person.partnerId, storeId: caller.store.id })
    return invitationId
  }

  builder.mutationFields((t) => ({
    inviteMember: t.field({
      type: 'Boolean',
      args: { email: t.arg.string({ required: true }), role: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: 'member.invited' } },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        const email = emailOf(args.email)
        const role = roleOf(args.role)
        const sql = sqlOf(ctx)
        // "Already a member here" comes first: it is the only refusal about the person (ACCESS.md §6.3).
        if (await withScope(sql, caller.context, (tx) => isMemberHere(tx, caller.store.id, email))) throw refused('ALREADY_MEMBER', 'They’re already in this store.')
        // Planned outside the transaction that writes: its unlocking-plan read needs system scope.
        if (role !== 'owner') {
          const seats = await withScope(sql, caller.context, (tx) => countStaffSeats(tx, caller.store.id))
          const limit = await planLimitFor(sql, caller.context, { key: 'staff', total: seats + 1 }, ctx.now())
          if (limit) throw refused('PLAN_LIMIT', 'Your plan has no more staff seats.', { key: limit.key, limit: limit.limit, unlockedBy: limit.unlockedBy })
        }
        await withScope(sql, caller.context, async (tx) => {
          if (await isMemberHere(tx, caller.store.id, email)) throw refused('ALREADY_MEMBER', 'They’re already in this store.')
          const invitationId = await sendInvitation(tx, ctx, email, role, await openInvitationTo(tx, caller.store.id, email))
          await ctx.activity.record(tx, entry(ctx, 'member.invited', { type: 'invitation', id: invitationId, label: email }, role))
        })
        return true
      },
    }),
    resendInvitation: t.field({
      type: 'Boolean',
      args: { invitationId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: 'member.invitation_resent' } },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        await withScope(sqlOf(ctx), caller.context, async (tx) => {
          const open = /^[0-9a-f-]{36}$/i.test(String(args.invitationId)) ? await selectOpenInvitation(tx, String(args.invitationId)) : null
          if (!open) throw refused('NOT_FOUND', 'That invitation is no longer open.')
          // A new link replaces the old (ACCESS.md §6.3): the old email stops working.
          const invitationId = await sendInvitation(tx, ctx, open.email, open.role_key, open.id)
          await ctx.activity.record(tx, entry(ctx, 'member.invitation_resent', { type: 'invitation', id: invitationId, label: open.email }, null))
        })
        return true
      },
    }),
    revokeInvitation: t.field({
      type: 'Boolean',
      args: { invitationId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: 'member.invitation_revoked' } },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        await withScope(sqlOf(ctx), caller.context, async (tx) => {
          const open = /^[0-9a-f-]{36}$/i.test(String(args.invitationId)) ? await selectOpenInvitation(tx, String(args.invitationId)) : null
          if (!open) throw refused('NOT_FOUND', 'That invitation is no longer open.')
          await revokeInvitation(tx, open.id, ctx.now())
          await ctx.activity.record(tx, entry(ctx, 'member.invitation_revoked', { type: 'invitation', id: open.id, label: open.email }, null))
        })
        return true
      },
    }),
    changeRole: t.field({
      type: 'Boolean',
      args: { membershipId: t.arg.id({ required: true }), role: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: 'member.role_changed' } },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        const role = roleOf(args.role)
        const sql = sqlOf(ctx)
        const id = String(args.membershipId)
        // An Owner becoming a Manager or Staff takes a seat, checked as an invitation is.
        const current = /^[0-9a-f-]{36}$/i.test(id) ? await withScope(sql, caller.context, (tx) => selectMember(tx, id)) : null
        if (current?.role_key === 'owner' && role !== 'owner') {
          const seats = await withScope(sql, caller.context, (tx) => countStaffSeats(tx, caller.store.id))
          const limit = await planLimitFor(sql, caller.context, { key: 'staff', total: seats + 1 }, ctx.now())
          if (limit) throw refused('PLAN_LIMIT', 'Your plan has no more staff seats.', { key: limit.key, limit: limit.limit, unlockedBy: limit.unlockedBy })
        }
        await withScope(sql, caller.context, async (tx) => {
          const member = /^[0-9a-f-]{36}$/i.test(id) ? await selectMember(tx, id) : null
          if (!member) throw refused('NOT_FOUND', 'They’re no longer in this store.')
          if (member.role_key === role) return
          if (member.role_key === 'owner' && (await countOtherOwners(tx, caller.store.id, member.id)) === 0) throw refused('LAST_OWNER', 'The last Owner can’t be demoted. Make someone else an Owner first.')
          await setMemberRole(tx, member.id, role)
          await ctx.activity.record(tx, { ...entry(ctx, 'member.role_changed', { type: 'membership', id: member.id, label: member.label }, null), changes: [{ field: 'role', before: member.role_key, after: role }] })
        })
        return true
      },
    }),
    removeMember: t.field({
      type: 'Boolean',
      args: { membershipId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: 'member.removed' } },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        await withScope(sqlOf(ctx), caller.context, async (tx) => {
          const member = /^[0-9a-f-]{36}$/i.test(String(args.membershipId)) ? await selectMember(tx, String(args.membershipId)) : null
          if (!member) throw refused('NOT_FOUND', 'They’re no longer in this store.')
          if (member.role_key === 'owner' && (await countOtherOwners(tx, caller.store.id, member.id)) === 0) throw refused('LAST_OWNER', 'The last Owner can’t be removed.')
          await removeMember(tx, member.id)
          await ctx.activity.record(tx, entry(ctx, 'member.removed', { type: 'membership', id: member.id, label: member.label }, null))
        })
        return true
      },
    }),
  }))
}
