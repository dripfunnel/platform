import { GraphQLError } from 'graphql'
import type { ShopperChannel, SignedIn } from '#auth/shopperAuth'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { selectCustomerAuth } from '#db/scoped/shopper'
import { createCartService } from '#engine/modules/cart/index'
import { createShopperAccount, shopperAccountAudit, type AccountResult, type AddressRow } from '#engine/modules/shopperAccount/index'
import { createShopperSignIn, shopperSignInAudit } from '#saas/shopperSignIn/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'

// Shopper accounts (FIRST-RELEASE §19 Shop API; ACCESS §2.1): sign-in by email and password or by a code, the account and
// its addresses. The session token goes back once and comes in as X-Shop-Session.

const words: Record<string, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  METHOD_OFF: 'This shop doesn’t sign in that way.',
  RATE_LIMITED: 'Too many tries. Wait a few minutes and try again.',
  CODE_REFUSED: 'That code didn’t work. Check it, or ask for a new one.',
  SIGN_IN_REFUSED: 'That email and password don’t match an account here.',
  WEAK_PASSWORD: 'Choose a password of at least 10 characters.',
  SIGNED_OUT: 'Sign in first.',
  NOT_FOUND: 'That is no longer here.',
  TOO_MANY: 'That’s as many addresses as an account keeps.',
}

const refuse = (reason: string) => new GraphQLError(words[reason] ?? words['INVALID_INPUT'] ?? '', { extensions: { code: reason } })

const answered = <T>(result: AccountResult<T> | { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (result.ok) return result.value
  throw refuse(result.reason)
}

const signInOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  return createShopperSignIn({ sql, storeId: shopper.context.storeId, partnerId: shopper.context.partnerId, activity: ctx.activity, facts: ctx.facts, allowAttempt: ctx.allowAttempt ?? (async () => false), now: ctx.now })
}

const accountOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  return createShopperAccount({ sql, context: shopper.context, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
}

/** A guest cart the request holds becomes the new session's account's; a failed claim never undoes the sign-in. */
const signedIn = async (ctx: ShopContext, result: SignedIn) => {
  if (!result.ok) throw refuse(result.reason)
  const { sql, shopper } = shopOf(ctx)
  if (shopper.context.caller.kind === 'shopper' && shopper.context.caller.orderTokenHash) {
    const context: TenantContext = { ...shopper.context, caller: { ...shopper.context.caller, customerId: result.customerId } }
    await createCartService({ sql, context, language: shopper.language, currency: shopper.currency, marketId: shopper.marketId, features: shopper.features, couriers: null, activity: ctx.activity, facts: ctx.facts, now: ctx.now }).claim()
  }
  return { token: result.token, created: result.created }
}

export const registerAccounts = ({ builder }: ShopBuilder) => {
  const Options = builder.objectRef<{ email: boolean; phone: boolean }>('ShopSignInOptions').implement({
    fields: (t) => ({ email: t.exposeBoolean('email'), phone: t.exposeBoolean('phone') }),
  })
  const Session = builder.objectRef<{ token: string; created: boolean }>('ShopSession').implement({
    fields: (t) => ({
      // Given once: send it back as X-Shop-Session.
      sessionToken: t.exposeString('token'),
      // True when this sign-in made the account.
      created: t.exposeBoolean('created'),
    }),
  })
  const Address = builder.objectRef<AddressRow>('ShopSavedAddress').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      line1: t.exposeString('line1'),
      line2: t.exposeString('line2', { nullable: true }),
      city: t.exposeString('city'),
      region: t.exposeString('region', { nullable: true }),
      postalCode: t.exposeString('postal_code', { nullable: true }),
      country: t.exposeString('country'),
      phone: t.exposeString('phone', { nullable: true }),
      isDefault: t.exposeBoolean('is_default_shipping'),
    }),
  })
  type Account = NonNullable<Awaited<ReturnType<ReturnType<typeof createShopperAccount>['account']>>>
  const Account = builder.objectRef<Account>('ShopAccount').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      emailVerified: t.boolean({ resolve: (a) => a.email_verified_at !== null }),
      phoneVerified: t.boolean({ resolve: (a) => a.phone_verified_at !== null }),
      addresses: t.field({ type: [Address], resolve: (a) => a.addresses }),
    }),
  })
  const AddressInput = builder.inputType('ShopSavedAddressInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      line1: t.string({ required: true }),
      line2: t.string(),
      city: t.string({ required: true }),
      region: t.string(),
      postalCode: t.string(),
      country: t.string({ required: true }),
      phone: t.string(),
    }),
  })
  const Channel = builder.enumType('ShopSignInChannel', { values: ['EMAIL', 'PHONE'] as const })
  const channelOf = (c: 'EMAIL' | 'PHONE'): ShopperChannel => (c === 'EMAIL' ? 'email' : 'phone')

  const access = { api: 'shop', scope: 'shop', permission: null } as const
  const long = (...values: (string | null | undefined)[]) => {
    if (values.some((v) => (v?.length ?? 0) > 320)) throw refuse('INVALID_INPUT')
  }

  builder.queryFields((t) => ({
    // How this shop's shoppers sign in (Settings › Customer accounts).
    signInOptions: t.field({
      type: Options,
      extensions: { access },
      resolve: async (_, __, ctx) => {
        const { sql, shopper } = shopOf(ctx)
        const auth = await withScope(sql, shopper.context, (tx) => selectCustomerAuth(tx, shopper.context.storeId))
        return { email: auth.email_enabled, phone: auth.phone_enabled }
      },
    }),
    // The signed-in shopper's own account; null when signed out.
    account: t.field({ type: Account, nullable: true, extensions: { access }, resolve: (_, __, ctx) => accountOf(ctx).account() }),
  }))

  builder.mutationFields((t) => ({
    // The same answer whether or not the email or number has an account (ACCESS §2).
    requestSignInCode: t.boolean({
      args: { channel: t.arg({ type: Channel, required: true }), to: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: shopperSignInAudit.codeRequested } },
      resolve: async (_, args, ctx) => {
        long(args.to)
        const asked = await signInOf(ctx).requestCode(channelOf(args.channel), args.to)
        if (!asked.ok) throw refuse(asked.reason)
        return true
      },
    }),
    // A code proves the email or number: signs in, making the account if there's none; with an email, a password sets it.
    verifySignInCode: t.field({
      type: Session,
      args: { channel: t.arg({ type: Channel, required: true }), to: t.arg.string({ required: true }), code: t.arg.string({ required: true }), name: t.arg.string(), password: t.arg.string() },
      extensions: { access: { ...access, audit: 'customer.signed_in' } },
      resolve: async (_, args, ctx) => {
        long(args.to, args.code, args.name, args.password)
        return signedIn(ctx, await signInOf(ctx).verifyCode(channelOf(args.channel), args.to, args.code, { name: args.name, password: args.password }))
      },
    }),
    signIn: t.field({
      type: Session,
      args: { email: t.arg.string({ required: true }), password: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: 'customer.signed_in' } },
      resolve: async (_, args, ctx) => {
        long(args.email, args.password)
        return signedIn(ctx, await signInOf(ctx).signIn(args.email, args.password))
      },
    }),
    // Ends the session this request presents.
    signOut: t.boolean({
      extensions: { access: { ...access, audit: 'customer.signed_out' } },
      resolve: async (_, __, ctx) => {
        return signInOf(ctx).signOut(ctx.sessionToken ?? '')
      },
    }),
    updateAccount: t.boolean({
      args: { name: t.arg.string() },
      extensions: { access: { ...access, audit: shopperAccountAudit.updated } },
      resolve: async (_, args, ctx) => answered(await accountOf(ctx).rename(args.name ?? null)),
    }),
    saveAddress: t.id({
      args: { id: t.arg.id(), address: t.arg({ type: AddressInput, required: true }), isDefault: t.arg.boolean() },
      extensions: { access: { ...access, audit: shopperAccountAudit.addressSaved } },
      resolve: async (_, args, ctx) => {
        long(...Object.values(args.address))
        return answered(await accountOf(ctx).save(args.id ? String(args.id) : null, args.address, args.isDefault ?? false))
      },
    }),
    deleteAddress: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: shopperAccountAudit.addressRemoved } },
      resolve: async (_, args, ctx) => answered(await accountOf(ctx).remove(String(args.id))),
    }),
  }))
}
