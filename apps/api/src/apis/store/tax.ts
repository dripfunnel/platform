import { GraphQLError } from 'graphql'
import { createTaxService, taxAudit, type CartTax, type InvoiceSettingsRow, type TaxResult, type TaxSetupRow } from '#engine/modules/tax/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Tax setup (SetOps): prices including tax, the classes and their rates, invoice settings; the Owner
// writes (`settings`), the merchant side reads (the product form's class picker). `taxQuote` prices a cart's tax.

const words: Record<Exclude<TaxResult<unknown>, { ok: true }>['reason'], string> = {
  NOT_FOUND: 'That is no longer here.',
  INVALID_INPUT: 'Something here isn’t valid.',
  DUPLICATE_NAME: 'Another one already has that name.',
  DEFAULT_CLASS: 'Make another category the default first.',
  CLASS_IN_USE: 'Products use this category. Move them to another first.',
  PRICE_REQUIRED: 'A product here has no price yet.',
}

const answered = <T>(result: TaxResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerTax = (builder: StoreBuilder) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    // Stripe Tax needs the store's connected Stripe account, which payments (SAPI 10) connects; until then a US
    // store's own state rates answer, as one with PayPal only does (decided on #337).
    return createTaxService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now, stripe: null })
  }

  const Class = builder.objectRef<TaxSetupRow['classes'][number]>('TaxClass').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      // Stripe's product tax code, which US checkouts are taxed by.
      taxCode: t.exposeString('tax_code', { nullable: true }),
      isDefault: t.exposeBoolean('is_default'),
      versions: t.exposeInt('versions'),
    }),
  })
  const Rate = builder.objectRef<TaxSetupRow['zones'][number]['rates'][number]>('TaxRate').implement({
    fields: (t) => ({ taxClassId: t.exposeID('tax_class_id'), rateBps: t.exposeInt('rate_bps') }),
  })
  const Zone = builder.objectRef<TaxSetupRow['zones'][number]>('TaxZone').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      countries: t.exposeStringList('countries'),
      // None: the whole of each country.
      regions: t.exposeStringList('regions'),
      rates: t.field({ type: [Rate], resolve: (z) => z.rates }),
    }),
  })
  const Setup = builder.objectRef<TaxSetupRow>('TaxSetup').implement({
    fields: (t) => ({
      pricesIncludeTax: t.exposeBoolean('tax_inclusive'),
      classes: t.field({ type: [Class], resolve: (s) => s.classes }),
      zones: t.field({ type: [Zone], resolve: (s) => s.zones }),
    }),
  })
  const Invoice = builder.objectRef<InvoiceSettingsRow>('InvoiceSettings').implement({
    fields: (t) => ({
      legalName: t.exposeString('legal_name'),
      taxPerLine: t.exposeBoolean('tax_per_line'),
      emailWithDispatch: t.exposeBoolean('email_with_dispatch'),
      footer: t.exposeString('footer'),
    }),
  })
  const Component = builder.objectRef<CartTax['lines'][number]['components'][number]>('TaxComponent').implement({
    fields: (t) => ({ name: t.exposeString('name'), rateBps: t.exposeInt('rateBps'), amount: t.string({ resolve: (c) => c.amount.toString() }) }),
  })
  const QuoteLine = builder.objectRef<CartTax['lines'][number]>('TaxQuoteLine').implement({
    fields: (t) => ({
      versionId: t.exposeID('id'),
      quantity: t.exposeInt('quantity'),
      lineAmount: t.string({ resolve: (l) => l.lineAmount.toString() }),
      rateBps: t.exposeInt('rateBps'),
      tax: t.string({ resolve: (l) => l.amount.toString() }),
      components: t.field({ type: [Component], resolve: (l) => l.components }),
    }),
  })
  const Quote = builder.objectRef<CartTax>('TaxQuote').implement({
    fields: (t) => ({
      currency: t.exposeString('currency'),
      pricesIncludeTax: t.exposeBoolean('inclusive'),
      // rates: the store's own; stripe: Stripe Tax on the store's account.
      source: t.exposeString('source'),
      lines: t.field({ type: [QuoteLine], resolve: (q) => q.lines }),
      total: t.string({ resolve: (q) => q.total.toString() }),
    }),
  })
  const ClassInput = builder.inputType('TaxClassInput', { fields: (t) => ({ name: t.string({ required: true }), taxCode: t.string(), isDefault: t.boolean() }) })
  const RateInput = builder.inputType('TaxRateInput', { fields: (t) => ({ taxClassId: t.id({ required: true }), rateBps: t.int({ required: true }) }) })
  const ZoneInput = builder.inputType('TaxZoneInput', {
    fields: (t) => ({ name: t.string({ required: true }), countries: t.stringList({ required: true }), regions: t.stringList(), rates: t.field({ type: [RateInput], required: true }) }),
  })
  const InvoiceInput = builder.inputType('InvoiceSettingsInput', { fields: (t) => ({ taxPerLine: t.boolean({ required: true }), emailWithDispatch: t.boolean({ required: true }), footer: t.string() }) })
  const CartLineInput = builder.inputType('TaxQuoteLineInput', { fields: (t) => ({ versionId: t.id({ required: true }), quantity: t.int({ required: true }) }) })
  const ShipToInput = builder.inputType('TaxShipToInput', { fields: (t) => ({ country: t.string({ required: true }), region: t.string(), postal: t.string() }) })

  const read = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const

  builder.queryFields((t) => ({
    taxSetup: t.field({ type: Setup, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).setup() }),
    invoiceSettings: t.field({ type: Invoice, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).invoiceSettings() }),
    taxQuote: t.field({
      type: Quote,
      args: { lines: t.arg({ type: [CartLineInput], required: true }), shipTo: t.arg({ type: ShipToInput, required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) =>
        answered(
          await service(ctx).quote(
            args.lines.map((l) => ({ versionId: String(l.versionId), quantity: l.quantity })),
            { country: args.shipTo.country.trim().toUpperCase(), region: args.shipTo.region?.trim() || null, postal: args.shipTo.postal?.trim() || null },
          ),
        ),
    }),
  }))

  builder.mutationFields((t) => ({
    setPricesIncludeTax: t.boolean({
      args: { included: t.arg.boolean({ required: true }) },
      extensions: { access: { ...write, audit: taxAudit.inclusiveChanged } },
      resolve: async (_, args, ctx) => answered(await service(ctx).setInclusive(args.included)),
    }),
    saveTaxClass: t.id({
      args: { id: t.arg.id(), input: t.arg({ type: ClassInput, required: true }) },
      extensions: { access: { ...write, audit: taxAudit.classSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveClass(args.id ? String(args.id) : null, args.input)),
    }),
    deleteTaxClass: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: taxAudit.classDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).deleteClass(String(args.id))),
    }),
    saveTaxZone: t.id({
      args: { id: t.arg.id(), input: t.arg({ type: ZoneInput, required: true }) },
      extensions: { access: { ...write, audit: taxAudit.zoneSaved } },
      resolve: async (_, args, ctx) =>
        answered(await service(ctx).saveZone(args.id ? String(args.id) : null, { ...args.input, rates: args.input.rates.map((r) => ({ taxClassId: String(r.taxClassId), rateBps: r.rateBps })) })),
    }),
    deleteTaxZone: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: taxAudit.zoneDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).deleteZone(String(args.id))),
    }),
    saveInvoiceSettings: t.boolean({
      args: { input: t.arg({ type: InvoiceInput, required: true }) },
      extensions: { access: { ...write, audit: taxAudit.invoiceSettingsSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveInvoice(args.input)),
    }),
  }))
}
