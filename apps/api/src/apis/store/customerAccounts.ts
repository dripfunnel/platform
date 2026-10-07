import { GraphQLError } from 'graphql'
import { createCustomerAccounts, customerAccountsAudit, type CustomerAccountsView } from '#engine/modules/customerAccounts/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Customer accounts (SetAccess): how shoppers sign in, and how many accounts each way; the Owner's (`settings`).

export const registerCustomerAccounts = (builder: StoreBuilder) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createCustomerAccounts({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const Settings = builder.objectRef<CustomerAccountsView>('CustomerAccounts').implement({
    fields: (t) => ({
      // email, mobile or both.
      mode: t.exposeString('mode'),
      customers: t.exposeInt('customers'),
      withEmail: t.exposeInt('with_email'),
      withPhone: t.exposeInt('with_phone'),
      // Those who can't sign in if mobile sign-in goes (SetAccess's warning), until the add-an-email step exists.
      phoneOnly: t.exposeInt('phone_only'),
    }),
  })

  const access = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const

  builder.queryFields((t) => ({
    customerAccounts: t.field({ type: Settings, extensions: { access }, resolve: (_, __, ctx) => service(ctx).settings() }),
  }))
  builder.mutationFields((t) => ({
    saveCustomerAccounts: t.field({
      type: Settings,
      args: { mode: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: customerAccountsAudit.saved } },
      resolve: async (_, args, ctx) => {
        const saved = await service(ctx).save(args.mode)
        if (!saved) throw new GraphQLError('Choose email, mobile or both.', { extensions: { code: 'INVALID_INPUT' } })
        return saved
      },
    }),
  }))
}
