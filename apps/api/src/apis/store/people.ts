import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import type { PersonRow } from '#db/scoped/people'
import { createStorePeopleService, peopleAudit, type PeopleResult } from '#saas/storePeople/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › People (ACCESS.md §6, SetTeam): Owner only (`invite`); the rules are saas/storePeople's,
// this file authorises, calls and words the refusals.

const words: Record<Exclude<PeopleResult, { ok: true }>['reason'], string> = {
  ALREADY_MEMBER: 'They’re already in this store.',
  NOT_FOUND: 'That person or invitation is no longer here.',
  LAST_OWNER: 'The last Owner can’t be demoted or removed. Make someone else an Owner first.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  INVALID_INPUT: 'Choose Owner, Manager or Staff.',
  RATE_LIMITED: 'Too many invitations for now. Try again later.',
  PLAN_LIMIT: 'Your plan has no more staff seats.',
}

/** True, or the refusal as a stable code with its facts (FIRST-RELEASE §19). */
const answered = (result: PeopleResult): true => {
  if (result.ok) return true
  const facts = result.reason === 'PLAN_LIMIT' ? { key: result.limit.key, limit: result.limit.limit, unlockedBy: result.limit.unlockedBy } : result.reason === 'RATE_LIMITED' ? { per: result.per } : {}
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
}

interface PersonView {
  id: string
  kind: 'member' | 'invitation'
  name: string | null
  email: string
  role: string
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

  const service = (ctx: StoreContext) => createStorePeopleService({ sql: sqlOf(ctx), caller: actingCaller(ctx), activity: ctx.activity, facts: ctx.facts, now: ctx.now })

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
        const rows = await service(ctx).list(filter, window)
        const page = pageOf(rows, window, (r) => ({ occurredAt: r.sort_at, id: r.id }))
        return { nodes: page.nodes.map((r) => viewOf(r, caller.person.id, ctx.now())), pageInfo: page.pageInfo }
      },
    }),
    peopleCounts: t.field({
      type: Counts,
      extensions: { access },
      resolve: (_, __, ctx) => service(ctx).counts(),
    }),
  }))

  builder.mutationFields((t) => ({
    inviteMember: t.field({
      type: 'Boolean',
      args: { email: t.arg.string({ required: true }), role: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: peopleAudit.inviteMember } },
      resolve: async (_, args, ctx) => answered(await service(ctx).invite(args.email, args.role)),
    }),
    resendInvitation: t.field({
      type: 'Boolean',
      args: { invitationId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: peopleAudit.resendInvitation } },
      resolve: async (_, args, ctx) => answered(await service(ctx).resend(String(args.invitationId))),
    }),
    revokeInvitation: t.field({
      type: 'Boolean',
      args: { invitationId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: peopleAudit.revokeInvitation } },
      resolve: async (_, args, ctx) => answered(await service(ctx).revoke(String(args.invitationId))),
    }),
    changeRole: t.field({
      type: 'Boolean',
      args: { membershipId: t.arg.id({ required: true }), role: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: peopleAudit.changeRole } },
      resolve: async (_, args, ctx) => answered(await service(ctx).changeRole(String(args.membershipId), args.role)),
    }),
    removeMember: t.field({
      type: 'Boolean',
      args: { membershipId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: peopleAudit.removeMember } },
      resolve: async (_, args, ctx) => answered(await service(ctx).remove(String(args.membershipId))),
    }),
  }))
}
