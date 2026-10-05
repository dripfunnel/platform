import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import type { TeamRow } from '#db/scoped/supplierTeam'
import { createSupplierTeamService, supplierTeamAudit, type SupplierTeamResult } from '#saas/supplierTeam/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Your team (ACCESS §7.5, VendorViews): a Supplier admin's (`supplier.team`), its own supplier only; the
// rules are saas/supplierTeam's, this file authorises, calls and words the refusals.

const words: Record<Exclude<SupplierTeamResult<unknown>, { ok: true }>['reason'], string> = {
  NOT_FOUND: 'That person or invitation is no longer here.',
  INVALID_INPUT: 'Choose Supplier admin or Supplier member.',
  INVALID_EMAIL: 'Enter an email like name@example.com.',
  LAST_ADMIN: 'This is the last admin, so the role can’t change and they can’t be removed. Make someone else an admin first.',
  ALREADY_MEMBER: 'They already work in this store.',
  RATE_LIMITED: 'Too many invitations for now. Try again later.',
}

const answered = <T>(result: SupplierTeamResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...(result.reason === 'RATE_LIMITED' ? { per: result.per } : {}) } })
}

interface TeamView {
  id: string
  kind: 'member' | 'invitation'
  name: string | null
  email: string
  role: string
  you: boolean
  lastAdmin: boolean
  since: string
  expiresAt: string | null
  expired: boolean
}

export const registerSupplierTeam = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    if (caller.context.sellerScope.kind !== 'seller') throw forbidden()
    return createSupplierTeamService({ sql: ctx.sql, caller, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const PersonType = builder.objectRef<TeamView>('SupplierTeamPerson').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // A member's id is the membership's, an invitation's the invitation's: each mutation names which it takes.
      kind: t.exposeString('kind'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email'),
      // supplier-admin | supplier-member
      role: t.exposeString('role'),
      you: t.exposeBoolean('you'),
      lastAdmin: t.exposeBoolean('lastAdmin'),
      since: t.exposeString('since'),
      expiresAt: t.exposeString('expiresAt', { nullable: true }),
      expired: t.exposeBoolean('expired'),
    }),
  })
  const TeamPage = builder.objectRef<{ nodes: TeamView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('SupplierTeam').implement({
    fields: (t) => ({ nodes: t.field({ type: [PersonType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const access = { api: 'store', scope: 'store-seller', permission: 'supplier.team', target: 'none' } as const
  const viewOf = (r: TeamRow, youId: string, now: Date): TeamView => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    email: r.email,
    role: r.role_key,
    you: r.user_id === youId,
    lastAdmin: r.last_admin,
    since: r.sort_at.toISOString(),
    expiresAt: r.expires_at?.toISOString() ?? null,
    expired: r.expires_at !== null && r.expires_at <= now,
  })

  builder.queryFields((t) => ({
    mySupplierTeam: t.field({
      type: TeamPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        const page = pageOf(await service(ctx).list(window), window, (r) => ({ occurredAt: r.sort_at, id: r.id }))
        return { nodes: page.nodes.map((r) => viewOf(r, actingCaller(ctx).person.id, ctx.now())), pageInfo: page.pageInfo }
      },
    }),
  }))

  builder.mutationFields((t) => ({
    // Answers the invitation's id.
    inviteSupplierUser: t.id({
      args: { email: t.arg.string({ required: true }), role: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: supplierTeamAudit.invited } },
      resolve: async (_, args, ctx) => answered(await service(ctx).invite(args.email, args.role)),
    }),
    resendSupplierInvitation: t.id({
      args: { invitationId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: supplierTeamAudit.invitationResent } },
      resolve: async (_, args, ctx) => answered(await service(ctx).resend(String(args.invitationId))),
    }),
    revokeSupplierInvitation: t.boolean({
      args: { invitationId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: supplierTeamAudit.invitationRevoked } },
      resolve: async (_, args, ctx) => answered(await service(ctx).revoke(String(args.invitationId))),
    }),
    changeSupplierRole: t.boolean({
      args: { membershipId: t.arg.id({ required: true }), role: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: supplierTeamAudit.roleChanged } },
      resolve: async (_, args, ctx) => answered(await service(ctx).changeRole(String(args.membershipId), args.role)),
    }),
    removeSupplierUser: t.boolean({
      args: { membershipId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: supplierTeamAudit.removed } },
      resolve: async (_, args, ctx) => answered(await service(ctx).remove(String(args.membershipId))),
    }),
  }))
}
