import { GraphQLError } from 'graphql'
import { z } from 'zod'
import { isCurrency } from '#core/money'
import { partnerPricing, type PricingPlan, type PricingPrice } from '#saas/planPricing/index'
import { rateLimited } from './access'
import { moneyType, planValueType, type StoreBuilder } from './builder'

// The partner's live plans for its own pricing page, before anyone signs in (SAAS.md §6.1, #459).

const currencyInput = z.string().regex(/^[A-Z]{3}$/).refine(isCurrency).nullish()

/** The limiter's own window, in seconds (wrangler.jsonc SHOP_RATE_LIMITER). */
const retryAfterSeconds = 60

export const registerPricing = (builder: StoreBuilder) => {
  const Money = moneyType(builder)
  const PlanValue = planValueType(builder)

  const Price = builder.objectRef<PricingPrice>('PricingPrice').implement({
    fields: (t) => ({
      currency: t.exposeString('currency'),
      monthly: t.field({ type: Money, nullable: true, resolve: (p) => p.monthly }),
      yearly: t.field({ type: Money, nullable: true, resolve: (p) => p.yearly }),
    }),
  })

  const Plan = builder.objectRef<PricingPlan>('PricingPlan').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      description: t.exposeString('description', { nullable: true }),
      trialDays: t.exposeInt('trialDays'),
      prices: t.field({ type: [Price], resolve: (p) => p.prices }),
      settings: t.field({ type: [PlanValue], resolve: (p) => p.settings }),
    }),
  })

  builder.queryFields((t) => ({
    pricing: t.field({
      type: [Plan],
      args: { currency: t.arg.string() },
      extensions: { access: { api: 'store', scope: 'public', permission: null } },
      resolve: async (_, args, ctx) => {
        const currency = currencyInput.safeParse(args.currency)
        if (!currency.success) throw new GraphQLError('That currency isn’t one we know.', { extensions: { code: 'INVALID_INPUT' } })
        if (!ctx.sql || !ctx.partnerId) return []
        const ip = ctx.facts.ip
        const allowed = ip !== null && ctx.allowPublicRead !== undefined && (await ctx.allowPublicRead(`pricing:${ctx.host ?? ctx.partnerId}:${ip}`))
        if (!allowed) throw rateLimited(retryAfterSeconds)
        return partnerPricing(ctx.sql, ctx.partnerId, currency.data ?? null)
      },
    }),
  }))
}
