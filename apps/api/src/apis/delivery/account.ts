import { GraphQLError } from 'graphql'
import type { OwnRiderRow } from '#db/scoped/riders'
import { createRiderProfile, riderProfileAudit, vehicleTypes, type ProfileResult } from '#engine/modules/ownDelivery/index'
import { createRiderSignIn, riderSignInAudit } from '#saas/riderSignIn/index'
import { unauthenticated } from '../graphql/scope'
import { riderOf, storeOf, type DeliveryContext } from './access'
import type { DeliveryBuilder } from './builder'

// A rider's sign-in and own account (DELIVERY §4, §5). The session token goes back once and comes in as
// `Authorization: Bearer`.

const words: Record<string, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  RATE_LIMITED: 'Too many tries. Wait a few minutes and try again.',
  CODE_REFUSED: 'That code didn’t work. Check it, or ask for a new one.',
  RIDER_SUSPENDED: 'The shop has paused your account. Ask the shop to restore it.',
  PHOTO_NOT_FOUND: 'Upload the photo again, then save.',
}

const refuse = (reason: string) => (reason === 'UNAUTHENTICATED' ? unauthenticated() : new GraphQLError(words[reason] ?? words['INVALID_INPUT'] ?? '', { extensions: { code: reason } }))

export const answered = <T>(result: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (result.ok) return result.value
  throw refuse(result.reason)
}

const signInOf = (ctx: DeliveryContext) => {
  const { sql, caller } = storeOf(ctx)
  return createRiderSignIn({ sql, storeId: caller.storeId, partnerId: caller.partnerId, activity: ctx.activity, facts: ctx.facts, allowAttempt: ctx.allowAttempt ?? (async () => false), codeCheck: ctx.codeCheck, defer: ctx.defer, now: ctx.now })
}

const profileOf = (ctx: DeliveryContext) => {
  const { sql, rider } = riderOf(ctx)
  return createRiderProfile({ sql, context: rider, activity: ctx.activity, facts: ctx.facts, files: ctx.files ?? null, now: ctx.now })
}

export const registerAccount = (builder: DeliveryBuilder) => {
  const VehicleType = builder.enumType('VehicleType', { values: vehicleTypes })
  const Session = builder.objectRef<{ token: string }>('RiderSession').implement({
    // Given once: send it back as `Authorization: Bearer <token>`.
    fields: (t) => ({ sessionToken: t.exposeString('token') }),
  })
  const Rider = builder.objectRef<OwnRiderRow>('Rider').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      phone: t.exposeString('phone', { nullable: true }),
      // An id from `POST /delivery-api/assets`; null until one is chosen.
      photoAssetId: t.exposeID('photo_asset_id', { nullable: true }),
      vehicleType: t.field({ type: VehicleType, nullable: true, resolve: (r) => (vehicleTypes as readonly string[]).includes(r.vehicle_type ?? '') ? (r.vehicle_type as (typeof vehicleTypes)[number]) : null }),
      vehicleNumber: t.exposeString('vehicle_number', { nullable: true }),
      createdAt: t.string({ resolve: (r) => r.created_at.toISOString() }),
    }),
  })

  const signedIn = { api: 'delivery', scope: 'rider', permission: null } as const
  const open = { api: 'delivery', scope: 'public', permission: null } as const

  builder.queryFields((t) => ({
    // Null when signed out, as the other APIs' `me` reads.
    me: t.field({
      type: Rider,
      nullable: true,
      extensions: { access: open },
      resolve: async (_, __, ctx) => (storeOf(ctx).caller.rider ? profileOf(ctx).me() : null),
    }),
  }))

  builder.mutationFields((t) => ({
    // The same answer for every number; a text goes only to an invited or active rider of this store (DELIVERY §4).
    requestCode: t.boolean({
      args: { phone: t.arg.string({ required: true }) },
      extensions: { access: { ...open, audit: riderSignInAudit.codeRequested } },
      resolve: async (_, args, ctx) => {
        const asked = await signInOf(ctx).requestCode(args.phone)
        if (!asked.ok) throw refuse(asked.reason)
        return true
      },
    }),
    signIn: t.field({
      type: Session,
      args: { phone: t.arg.string({ required: true }), code: t.arg.string({ required: true }) },
      extensions: { access: { ...open, audit: 'rider.signed_in' } },
      resolve: async (_, args, ctx) => {
        const result = await signInOf(ctx).signIn(args.phone, args.code)
        if (!result.ok) throw refuse(result.reason)
        return { token: result.token }
      },
    }),
    signOut: t.boolean({
      extensions: { access: { ...open, audit: 'rider.signed_out' } },
      resolve: async (_, __, ctx) => {
        const token = storeOf(ctx).caller.token
        return token ? signInOf(ctx).signOut(token) : true
      },
    }),
    updateProfile: t.field({
      type: Rider,
      args: {
        name: t.arg.string({ required: true }),
        photoAssetId: t.arg.id(),
        vehicleType: t.arg({ type: VehicleType }),
        vehicleNumber: t.arg.string(),
      },
      extensions: { access: { ...signedIn, audit: riderProfileAudit.profileSaved } },
      resolve: async (_, args, ctx) =>
        answered<OwnRiderRow>(
          await profileOf(ctx).update({ name: args.name, photoAssetId: args.photoAssetId == null ? null : String(args.photoAssetId), vehicleType: args.vehicleType ?? null, vehicleNumber: args.vehicleNumber ?? null }),
        ),
    }),
    // The rider's own account only: signed out everywhere, phone and photo erased (DELIVERY §5).
    deleteMyAccount: t.boolean({
      extensions: { access: { ...signedIn, audit: riderProfileAudit.accountDeleted } },
      resolve: async (_, __, ctx) => answered<true>((await profileOf(ctx).deleteAccount()) satisfies ProfileResult<true>),
    }),
  }))
}
