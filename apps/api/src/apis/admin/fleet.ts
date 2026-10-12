import { GraphQLError } from 'graphql'
import { fleetAudit, type FleetResult, type RolloutView } from '#saas/fleet/admin'
import { builder } from './builder'
import { iso, PageInfoType, signedIn } from './types'

// Core rollouts on the Admin API (SAAS §10, §13): Engineer on call and Super admin read and steer them; CONSOLE-DESIGN
// part L's screens are their own card.

const StoreCount = builder.objectRef<RolloutView['stores'][number]>('CoreRolloutStoreCount').implement({
  fields: (t) => ({ state: t.exposeString('state'), count: t.exposeInt('n') }),
})

const Rollout = builder.objectRef<RolloutView>('CoreRollout').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    version: t.exposeString('version'),
    security: t.exposeBoolean('security'),
    state: t.exposeString('state'),
    percent: t.exposeInt('percent'),
    reason: t.exposeString('reason'),
    startedAt: t.string({ resolve: (r) => r.started_at.toISOString() }),
    finishedAt: t.string({ nullable: true, resolve: (r) => iso(r.finished_at) }),
    stores: t.field({ type: [StoreCount], resolve: (r) => r.stores }),
  }),
})

const RolloutPage = builder.objectRef<{ items: RolloutView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('CoreRolloutPage').implement({
  fields: (t) => ({ items: t.field({ type: [Rollout], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const read = { access: { api: 'admin' as const, scope: 'platform' as const, permission: 'fleet.read' as const, target: 'none' as const } }
const manage = (audit: string) => ({ access: { api: 'admin' as const, scope: 'platform' as const, permission: 'fleet.manage' as const, target: 'none' as const, audit } })

const answered = (result: FleetResult): RolloutView => {
  if (result.ok) return result.rollout
  throw new GraphQLError('That rollout can’t be changed.', { extensions: { code: result.code } })
}

builder.queryFields((t) => ({
  coreRollouts: t.field({
    type: RolloutPage,
    args: { first: t.arg.int(), after: t.arg.string() },
    extensions: read,
    resolve: async (_, args, ctx) => {
      const page = await signedIn(ctx.fleet ?? null).list(args)
      if (!page) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
  coreRollout: t.field({ type: Rollout, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: read, resolve: (_, { id }, ctx) => signedIn(ctx.fleet ?? null).get(String(id)) }),
}))

builder.mutationFields((t) => ({
  startCoreRollout: t.field({
    type: Rollout,
    args: { version: t.arg.string({ required: true }), security: t.arg.boolean({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(fleetAudit.started),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.fleet ?? null).start(args)),
  }),
  pauseCoreRollout: t.field({
    type: Rollout,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(fleetAudit.paused),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.fleet ?? null).pause(String(args.id), args.reason)),
  }),
  resumeCoreRollout: t.field({
    type: Rollout,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(fleetAudit.resumed),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.fleet ?? null).resume(String(args.id), args.reason)),
  }),
  rollBackCoreRollout: t.field({
    type: Rollout,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(fleetAudit.rolledBack),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.fleet ?? null).rollBack(String(args.id), args.reason)),
  }),
}))
