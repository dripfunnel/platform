import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { createGiftCardService, giftCardsAudit, type GiftCardRefusal, type GiftCardResult, type IssuedGiftCardRow } from '#engine/modules/giftCards/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyType, pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// A gift card product's cards issued, and "Issue a card" for store credit or a goodwill gesture (CatEditor). The merchant
// side's: a card's code is never shown here, only its last four characters.

const words: Record<GiftCardRefusal, string> = {
  NOT_FOUND: 'That gift card amount isn’t here any more.',
  INVALID_INPUT: 'Enter an email like name@example.com.',
  READ_ONLY: 'A read-only support session can’t change this store.',
  KEY_REUSED: 'That request already issued a different card. Open Issue a card again to send another.',
}

const answered = <T>(result: GiftCardResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerGiftCards = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const Money = moneyType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createGiftCardService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const Card = builder.objectRef<IssuedGiftCardRow>('IssuedGiftCard').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // Null until its email has gone (on the day its buyer chose).
      last4: t.exposeString('code_last4', { nullable: true }),
      recipientName: t.exposeString('recipient_name', { nullable: true }),
      recipientEmail: t.exposeString('recipient_email'),
      amount: t.field({ type: Money, resolve: (c) => ({ amount: c.initial_amount, currency: c.currency }) }),
      balance: t.field({ type: Money, resolve: (c) => ({ amount: c.balance_amount, currency: c.currency }) }),
      sendOn: t.exposeString('send_on', { nullable: true }),
      sentAt: t.string({ nullable: true, resolve: (c) => c.sent_at?.toISOString() ?? null }),
      expiresAt: t.string({ nullable: true, resolve: (c) => c.expires_at?.toISOString() ?? null }),
      // order or issued: bought by a shopper, or issued by the store.
      source: t.string({ resolve: (c) => (c.by_order ? 'order' : 'issued') }),
      status: t.exposeString('status'),
      createdAt: t.string({ resolve: (c) => c.created_at.toISOString() }),
    }),
  })
  const CardPage = builder.objectRef<{ nodes: IssuedGiftCardRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('IssuedGiftCardPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Card], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const read = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none' } as const

  builder.queryFields((t) => ({
    giftCards: t.field({
      type: CardPage,
      args: { productId: t.arg.id({ required: true }), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).issued(String(args.productId), window), window, (c) => ({ occurredAt: c.created_at, id: c.id }))
      },
    }),
  }))
  builder.mutationFields((t) => ({
    // One of the product's amounts (a version), emailed now with its code, logged under the person's name. `issueKey` is a
    // UUID made once per request: sending it again answers the same card.
    issueGiftCard: t.id({
      args: { productId: t.arg.id({ required: true }), versionId: t.arg.id({ required: true }), recipientEmail: t.arg.string({ required: true }), recipientName: t.arg.string(), issueKey: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: giftCardsAudit.issued } },
      resolve: async (_, args, ctx) => {
        if (args.recipientEmail.length > 320 || (args.recipientName?.length ?? 0) > 200) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        return answered(await service(ctx).issue(String(args.productId), String(args.versionId), { email: args.recipientEmail, name: args.recipientName ?? null, issueKey: String(args.issueKey) }))
      },
    }),
  }))
}
