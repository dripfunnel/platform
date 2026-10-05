import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { createMarketsService, marketsAudit, offeredLanguages, type LocaleRow, type MarketRow, type MarketsResult, type RateRow } from '#engine/modules/markets/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › Store info's languages and currencies, and Settings › Markets (CATALOG N, O; SetStore, SetMarkets):
// the Owner writes (`settings`); the merchant side reads them for the product form's prices and languages.

const words: Record<Exclude<MarketsResult<unknown>, { ok: true }>['reason'], string> = {
  INVALID_LANGUAGE: 'Choose from the languages offered.',
  MAIN_LANGUAGE_REQUIRED: 'Your main language has to be one of your languages.',
  INVALID_CURRENCY: 'That isn’t a currency you can add here.',
  INVALID_COUNTRY: 'That isn’t a country we know.',
  COUNTRIES_REQUIRED: 'Pick at least one country.',
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That is no longer here.',
  STALE_REVISION: 'Someone else changed this market. Reload to see their changes.',
  CURRENCY_REQUIRED: 'Set your main currency first.',
  NOT_OFFERED: 'Add that currency and language in Store info first.',
  PRIMARY_MARKET: 'Your primary market can’t be switched off, moved or deleted.',
  COUNTRY_TAKEN: 'A country can only be in one market.',
  NOT_PARENTS_COUNTRIES: 'A sub-market sells in its parent’s countries only.',
  BAD_PARENT: 'A sub-market sits under a top-level market.',
  DUPLICATE_NAME: 'Another market already has that name.',
  DUPLICATE_PATH: 'Another market already uses that web address.',
  PLAN_LIMIT: 'Your plan doesn’t include more.',
}

/** The markets service for the acting caller; products.ts prices with it too. */
export const marketsService = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const sql = ctx.sql
  const caller = actingCaller(ctx)
  return createMarketsService({
    sql,
    context: caller.context,
    actor: { id: caller.person.id, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    now: ctx.now,
    allowance: (key) => allowanceFor(sql, caller.context, key, ctx.now()),
  })
}

export const registerMarkets = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = marketsService

  const answered = async <T>(ctx: StoreContext, result: MarketsResult<T>): Promise<T> => {
    if (result.ok) return result.value
    if (result.reason === 'PLAN_LIMIT' && ctx.sql) {
      const limit = await planLimitFor(ctx.sql, actingCaller(ctx).context, { key: result.key, total: result.wanted }, ctx.now())
      throw new GraphQLError(words.PLAN_LIMIT, { extensions: { code: 'PLAN_LIMIT', key: result.key, limit: limit?.limit ?? 0, unlockedBy: limit?.unlockedBy ?? null } })
    }
    throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
  }

  const Language = builder.objectRef<LocaleRow['languages'][number]>('StoreLanguage').implement({
    fields: (t) => ({ code: t.exposeString('language'), status: t.exposeString('status') }),
  })
  const Currency = builder.objectRef<LocaleRow['currencies'][number]>('StoreCurrency').implement({
    fields: (t) => ({
      code: t.exposeString('currency'),
      // manual: typed per product; convert: from the pricing currency, rounded (CATALOG O2).
      mode: t.exposeString('mode'),
      rounding: t.exposeString('rounding'),
      status: t.exposeString('status'),
    }),
  })
  const Rate = builder.objectRef<RateRow>('ReferenceRate').implement({
    fields: (t) => ({
      currency: t.exposeString('currency'),
      perEuro: t.exposeString('per_euro'),
      publishedOn: t.exposeString('published_on'),
      fetchedAt: t.string({ resolve: (r) => r.fetched_at.toISOString() }),
    }),
  })
  const Locale = builder.objectRef<LocaleRow>('StoreLocale').implement({
    fields: (t) => ({
      mainLanguage: t.exposeString('main_language'),
      pricingCurrency: t.exposeString('pricing_currency', { nullable: true }),
      // Removed ones are listed too: their text and prices are kept, hidden (CATALOG N13, O9).
      languages: t.field({ type: [Language], resolve: (l) => l.languages }),
      currencies: t.field({ type: [Currency], resolve: (l) => l.currencies }),
      offeredLanguages: t.stringList({ resolve: () => [...offeredLanguages] }),
      // The rates its converted prices use (CATALOG O5): a currency missing here isn't for sale until one arrives.
      rates: t.field({ type: [Rate], resolve: (_, __, ctx) => service(ctx).rates() }),
    }),
  })
  const Duties = builder.objectRef<MarketRow>('MarketDuties').implement({
    fields: (t) => ({
      mode: t.exposeString('duties_mode'),
      rateBps: t.exposeInt('duties_rate_bps', { nullable: true }),
      thresholdAmount: t.exposeString('duties_threshold_amount', { nullable: true }),
    }),
  })
  const ExcludedProduct = builder.objectRef<{ id: string; name: string }>('MarketExcludedProduct').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
  })
  const Market = builder.objectRef<MarketRow>('Market').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      parentId: t.exposeID('parent_id', { nullable: true }),
      name: t.exposeString('name'),
      primary: t.exposeBoolean('is_primary'),
      everywhereElse: t.exposeBoolean('is_fallback'),
      countries: t.exposeStringList('countries'),
      currency: t.exposeString('currency'),
      language: t.exposeString('language'),
      priceAdjustmentBps: t.exposeInt('price_adjustment_bps'),
      // main: the store's address; path: the address plus /{pathPrefix} (one domain per store, decided on #337).
      webMode: t.exposeString('web_mode'),
      pathPrefix: t.exposeString('path_prefix', { nullable: true }),
      products: t.exposeString('products'),
      excludedProductIds: t.exposeIDList('excluded_product_ids'),
      excludedProducts: t.field({ type: [ExcludedProduct], resolve: (m) => m.excluded_products }),
      duties: t.field({ type: Duties, resolve: (m) => m }),
      active: t.boolean({ resolve: (m) => m.status === 'active' }),
      revision: t.exposeInt('revision'),
    }),
  })
  const MarketPage = builder.objectRef<{ nodes: MarketRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('MarketPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Market], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const CurrencyInputType = builder.inputType('StoreCurrencyInput', {
    fields: (t) => ({ code: t.string({ required: true }), mode: t.string({ required: true }), rounding: t.string() }),
  })
  const MarketInputType = builder.inputType('MarketInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      parentId: t.id(),
      countries: t.stringList({ required: true }),
      currency: t.string({ required: true }),
      language: t.string({ required: true }),
      priceAdjustmentBps: t.int(),
      webMode: t.string(),
      pathPrefix: t.string(),
      products: t.string(),
      excludedProductIds: t.idList(),
      dutiesMode: t.string(),
      dutiesRateBps: t.int(),
      dutiesThresholdAmount: t.string(),
      active: t.boolean(),
    }),
  })

  const read = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const

  builder.queryFields((t) => ({
    storeLocale: t.field({ type: Locale, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).locale() }),
    markets: t.field({
      type: MarketPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).markets(window), window, (m) => ({ occurredAt: m.created_at, id: m.id }))
      },
    }),
    market: t.field({ type: Market, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, args, ctx) => service(ctx).market(String(args.id)) }),
  }))

  builder.mutationFields((t) => ({
    saveLanguages: t.boolean({
      args: { languages: t.arg.stringList({ required: true }), main: t.arg.string({ required: true }) },
      extensions: { access: { ...write, audit: marketsAudit.languagesSaved } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).saveLanguages(args.languages, args.main)),
    }),
    saveCurrencies: t.boolean({
      args: { currencies: t.arg({ type: [CurrencyInputType], required: true }) },
      extensions: { access: { ...write, audit: marketsAudit.currenciesSaved } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).saveCurrencies(args.currencies)),
    }),
    saveMarket: t.field({
      type: Market,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: MarketInputType, required: true }) },
      extensions: { access: { ...write, audit: marketsAudit.marketSaved } },
      resolve: async (_, args, ctx) => {
        const saved = await answered(ctx, await service(ctx).saveMarket(args.id ? String(args.id) : null, args.revision ?? null, args.input))
        const market = await service(ctx).market(saved.id)
        if (!market) throw new GraphQLError(words.NOT_FOUND, { extensions: { code: 'NOT_FOUND' } })
        return market
      },
    }),
    deleteMarket: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: marketsAudit.marketDeleted } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).removeMarket(String(args.id))),
    }),
    setEverywhereElse: t.boolean({
      args: { marketId: t.arg.id() },
      extensions: { access: { ...write, audit: marketsAudit.fallbackChanged } },
      resolve: async (_, args, ctx) => answered(ctx, await service(ctx).setFallback(args.marketId ? String(args.marketId) : null)),
    }),
  }))
}
