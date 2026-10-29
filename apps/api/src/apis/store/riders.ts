import { GraphQLError } from 'graphql'
import { catalogExportKind, type CatalogExportDto } from '#engine/modules/catalog/index'
import { pageOf, pageWindow } from '#core/paging'
import type { RiderRow } from '#db/scoped/riders'
import { createRiders, ridersAudit, type RidersResult } from '#engine/modules/ownDelivery/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { queueSideEffect } from '#saas/outbox/index'
import { queueSms } from '#saas/sms/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'

// Settings › Riders (DELIVERY §5, §8; SetRiders): the Owner's (`riders.manage`), never a support session's, as the
// list holds riders' phones. The rules are engine/modules/ownDelivery's; this file authorises, calls and words the refusals.

const words: Record<Exclude<RidersResult<unknown>, { ok: true }>['reason'], string> = {
  FORBIDDEN: 'You can’t change riders.',
  RIDER_HAS_PARCEL: 'This rider is carrying a parcel. Finish or reassign the delivery first.',
  NOT_FOUND: 'That rider is no longer here.',
  INVALID_INPUT: 'Enter the rider’s name, or the reason for erasing.',
  INVALID_PHONE: 'Enter the mobile number with its country code, such as +91 98765 43210.',
  PHONE_TAKEN: 'That number is already one of your riders.',
  NOT_INVITED: 'That rider has already joined.',
  NOT_ACTIVE: 'Only an active rider can be suspended.',
  NOT_SUSPENDED: 'That rider isn’t suspended.',
  RATE_LIMITED: 'That rider has had three texts today. Try again tomorrow.',
  UNAVAILABLE: 'Own delivery isn’t available for this store yet.',
  PLAN_LIMIT: 'Your plan doesn’t include more riders.',
}

/** DELIVERY §8: 50 a page unless asked, at most 100. */
const ridersPage = { first: 50, max: 100 }

export const registerRiders = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const sql = ctx.sql
    const caller = actingCaller(ctx)
    const brand = caller.store.name.trim().slice(0, 30)
    return createRiders({
      sql,
      context: caller.context,
      actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      plan: {
        ownDelivery: async () => (await planLimitFor(sql, caller.context, { key: 'own_delivery' }, ctx.now())) === null,
        allowance: () => allowanceFor(sql, caller.context, 'riders', ctx.now()),
      },
      shopDomain: ctx.domains?.shopDomain ?? null,
      queueExport: (tx, payload) => queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: payload.jobId, payload, partnerId: payload.partnerId, storeId: payload.storeId }),
      deleteFiles: ctx.files?.delete ? (keys) => ctx.files?.delete?.(keys) ?? Promise.resolve() : null,
      send: async (tx, invitation) => {
        await queueSms(tx, {
          partnerId: caller.person.partnerId,
          storeId: caller.store.id,
          idempotencyKey: `rider.invited:${invitation.riderId}:${crypto.randomUUID()}`,
          payload: { message: 'rider.invited', to: invitation.phone, brand, vars: { link: invitation.link }, expiresAt: null },
        })
      },
      now: ctx.now,
    })
  }

  const answered = async <T>(ctx: StoreContext, result: RidersResult<T>): Promise<T> => {
    if (result.ok) return result.value
    if (result.reason === 'PLAN_LIMIT' && ctx.sql) {
      const caller = actingCaller(ctx)
      const check = result.key === 'riders' ? { key: result.key, total: result.wanted ?? 0 } : { key: result.key }
      const limit = await planLimitFor(ctx.sql, caller.context, check, ctx.now())
      throw new GraphQLError(result.key === 'riders' ? words.PLAN_LIMIT : 'Your plan doesn’t include own delivery.', { extensions: { code: 'PLAN_LIMIT', key: result.key, limit: limit?.limit ?? null, unlockedBy: limit?.unlockedBy ?? null } })
    }
    throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
  }

  const RiderType = builder.objectRef<RiderRow>('Rider').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      phone: t.exposeString('phone', { nullable: true }),
      // invited (hasn't signed in yet) | active | suspended.
      status: t.exposeString('status'),
      online: t.exposeBoolean('online'),
      vehicleType: t.exposeString('vehicle_type', { nullable: true }),
      vehicleNumber: t.exposeString('vehicle_number', { nullable: true }),
      // Deliveries come with DL 5 and DL 6 (#842, #843).
      deliveriesDone: t.int({ resolve: () => 0 }),
      currentDeliveryId: t.exposeID('current_delivery_id', { nullable: true }),
      createdAt: t.string({ resolve: (r) => r.created_at.toISOString() }),
    }),
  })
  const RiderPage = builder.objectRef<{ nodes: RiderRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('RiderPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [RiderType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const RiderExport = builder.objectRef<CatalogExportDto>('RiderExport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // queued, done, failed or expired
      state: t.exposeString('state'),
      rows: t.exposeInt('rows', { nullable: true }),
      truncated: t.exposeBoolean('truncated'),
      csv: t.exposeString('csv', { nullable: true }),
      requestedAt: t.string({ resolve: (e) => e.requestedAt.toISOString() }),
      expiresAt: t.string({ nullable: true, resolve: (e) => e.expiresAt?.toISOString() ?? null }),
    }),
  })

  const riders = { api: 'store', scope: 'store', permission: 'riders.manage', target: 'none', blockedFor: ['support'] } as const

  builder.queryFields((t) => ({
    riders: t.field({
      type: RiderPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: riders },
      resolve: async (_, args, ctx) => {
        const page = pageWindow({ first: args.first ?? ridersPage.first, after: args.after, before: args.before }, ridersPage.max)
        if (!page.ok) throw new GraphQLError('That page link has expired. Start again.', { extensions: { code: page.code } })
        return pageOf(await service(ctx).list(page.window), page.window, (r) => ({ occurredAt: r.created_at, id: r.id }))
      },
    }),
  }))

  // An export is a read, so a read-only store allows it; both are the Owner's, never a support session's.
  builder.queryFields((t) => ({
    riderExport: t.field({
      type: RiderExport,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: riders },
      resolve: (_, args, ctx) => service(ctx).exportJob(String(args.id)),
    }),
  }))

  builder.mutationFields((t) => ({
    exportRider: t.id({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...riders, whileReadOnly: true, audit: ridersAudit.exported } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).exportData(String(args.id))),
    }),
    // Removal, then the rider's name, number, photo, sessions, devices and position are gone (DELIVERY §5).
    eraseRider: t.boolean({
      args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
      extensions: { access: { ...riders, audit: ridersAudit.erased } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).erase(String(args.id), args.reason)),
    }),
  }))

  builder.mutationFields((t) => ({
    // Texts the number the store's delivery app link; signing in with it is joining (DELIVERY §5).
    inviteRider: t.field({
      type: RiderType,
      args: { name: t.arg.string({ required: true }), phone: t.arg.string({ required: true }) },
      extensions: { access: { ...riders, audit: ridersAudit.invited } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).invite({ name: args.name, phone: args.phone })),
    }),
    resendRiderInvitation: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...riders, audit: ridersAudit.invitationResent } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).resend(String(args.id))),
    }),
    suspendRider: t.field({
      type: RiderType,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...riders, audit: ridersAudit.suspended } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).suspend(String(args.id))),
    }),
    restoreRider: t.field({
      type: RiderType,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...riders, audit: ridersAudit.restored } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).restore(String(args.id))),
    }),
    removeRider: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...riders, audit: ridersAudit.removed } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).remove(String(args.id))),
    }),
  }))
}
