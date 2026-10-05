import { GraphQLError } from 'graphql'
import { createStoreInfoService, storeInfoAudit, type StoreInfoResult, type StoreInfoRow } from '#engine/modules/storeInfo/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Store info (SetStore): the Owner writes (`settings`); the merchant side reads it (units, time zone).

const words: Record<Exclude<StoreInfoResult<unknown>, { ok: true }>['reason'], string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  INVALID_TIME_ZONE: 'Choose a time zone from the list.',
  INVALID_TAX_ID: 'That tax id isn’t in the format your country uses.',
  INVALID_LOGO: 'Use an image you uploaded to this store.',
  NOT_FOUND: 'That is no longer here.',
}

export const registerStoreInfo = (builder: StoreBuilder) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createStoreInfoService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const Address = builder.objectRef<StoreInfoRow['address']>('StoreAddress').implement({
    fields: (t) => ({
      street: t.string({ resolve: (a) => a.street ?? '' }),
      city: t.string({ resolve: (a) => a.city ?? '' }),
      postal: t.string({ resolve: (a) => a.postal ?? '' }),
      region: t.string({ resolve: (a) => a.region ?? '' }),
    }),
  })
  const Info = builder.objectRef<StoreInfoRow>('StoreInfo').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      legalName: t.exposeString('legal_name'),
      description: t.exposeString('description'),
      logoAssetId: t.exposeID('logo_asset_id', { nullable: true }),
      address: t.field({ type: Address, resolve: (i) => i.address }),
      contactEmail: t.exposeString('contact_email', { nullable: true }),
      contactPhone: t.exposeString('contact_phone', { nullable: true }),
      // Set at sign-up; selling abroad is Markets'.
      country: t.exposeString('country', { nullable: true }),
      taxId: t.exposeString('tax_id', { nullable: true }),
      timeZone: t.exposeString('time_zone'),
      unitSystem: t.exposeString('unit_system'),
      orderPrefix: t.exposeString('order_prefix'),
      nextOrderNumber: t.exposeString('next_order_number'),
    }),
  })
  const AddressInput = builder.inputType('StoreAddressInput', {
    fields: (t) => ({ street: t.string(), city: t.string(), postal: t.string(), region: t.string() }),
  })
  const InfoInput = builder.inputType('StoreInfoInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      legalName: t.string(),
      description: t.string(),
      logoAssetId: t.id(),
      address: t.field({ type: AddressInput }),
      contactEmail: t.string(),
      contactPhone: t.string(),
      taxId: t.string(),
      timeZone: t.string({ required: true }),
      unitSystem: t.string({ required: true }),
      orderPrefix: t.string(),
      nextOrderNumber: t.int({ required: true }),
    }),
  })

  builder.queryFields((t) => ({
    storeInfo: t.field({
      type: Info,
      nullable: true,
      extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } },
      resolve: (_, __, ctx) => service(ctx).info(),
    }),
  }))

  builder.mutationFields((t) => ({
    saveStoreInfo: t.boolean({
      args: { input: t.arg({ type: InfoInput, required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'settings', target: 'none', audit: storeInfoAudit.saved } },
      resolve: async (_, args, ctx) => {
        const input = args.input
        const result = await service(ctx).save({
          ...input,
          logoAssetId: input.logoAssetId ? String(input.logoAssetId) : null,
          address: input.address ? { street: input.address.street ?? '', city: input.address.city ?? '', postal: input.address.postal ?? '', region: input.address.region ?? '' } : null,
        })
        if (result.ok) return result.value
        throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
      },
    }),
  }))
}
