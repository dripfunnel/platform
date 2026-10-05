import { GraphQLError } from 'graphql'
import { approvalAudit, createApprovalService, maxSendBackReason, type ApprovalResult } from '#engine/modules/catalog/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Approval of suppliers' products (ACCESS §7.2, CATALOG L): the switch and the review are the Owner's
// (`approve`); everyone in the store, a supplier included, reads whether it's on, for L1 and L2's wording.

const words: Record<Exclude<ApprovalResult<unknown>, { ok: true }>['reason'], string> = {
  NOT_FOUND: 'That product isn’t waiting for approval.',
  REASON_REQUIRED: `Say why, in up to ${maxSendBackReason} characters: the supplier sees it.`,
}

const answered = <T>(result: ApprovalResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerApproval = (builder: StoreBuilder) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createApprovalService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }
  const approve = { api: 'store', scope: 'store', permission: 'approve', target: 'none' } as const

  // The menu's badges (FIRST-RELEASE §3.1); orders' count comes with SAPI 11.
  const NavBadges = builder.objectRef<{ products: number }>('StoreNavBadges').implement({
    fields: (t) => ({ products: t.exposeInt('products') }),
  })

  builder.queryFields((t) => ({
    navBadges: t.field({
      type: NavBadges,
      extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } },
      resolve: async (_, __, ctx) => ({ products: await service(ctx).awaiting() }),
    }),
    supplierApprovalRequired: t.boolean({
      extensions: { access: { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } },
      resolve: (_, __, ctx) => service(ctx).required(),
    }),
  }))

  builder.mutationFields((t) => ({
    setApproval: t.boolean({
      args: { on: t.arg.boolean({ required: true }) },
      extensions: { access: { ...approve, audit: approvalAudit.settingChanged } },
      resolve: (_, args, ctx) => service(ctx).setRequired(args.on),
    }),
    approveProduct: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...approve, audit: approvalAudit.approved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).approve(String(args.id))),
    }),
    sendBackProduct: t.boolean({
      args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
      extensions: { access: { ...approve, audit: approvalAudit.sentBack } },
      resolve: async (_, args, ctx) => answered(await service(ctx).sendBack(String(args.id), args.reason)),
    }),
  }))
}
