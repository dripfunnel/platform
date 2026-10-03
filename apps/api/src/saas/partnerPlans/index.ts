import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { partnerRoleHas } from '#auth/partnerPermissions'
import { decodeCursor, encodeCursor } from '#core/cursor'
import type { PlanStatus } from '#db/schema/saas'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { insertPlan } from '#db/scoped/partners'
import {
  lockLivePlans,
  scheduleSubscriptionMoves,
  selectCatalogue,
  selectCataloguePlan,
  selectLivePlanChoices,
  selectLowestFee,
  selectPlanCurrencies,
  selectCeilings,
  selectContractTerms,
  selectCurrentVersions,
  updatePlanStatus,
  updatePlanText,
  type CatalogueRow,
  type ContractTerms,
} from '#db/scoped/partnerPlans'
import { insertPlanVersion, type AmountKey, type Entitlements, type PlanVersionPrice, type SwitchKey } from '#db/scoped/plans'

// Plans on the Platform API (ui/platform/FIRST-RELEASE.md §7; card #161). The API computes the
// fee, the margin and every refusal; the console only displays them.

// The console's row keys (apps/ui/platform/src/api/plans.ts) and the catalogue's (DATA-MODEL §2.3).
const switchRows = { domain: 'custom_domain', offers: 'offers', suppliersOn: 'suppliers_enabled', powered: 'powered_by_removal', aplus: 'aplus', size: 'size_charts' } as const satisfies Record<string, SwitchKey>
const amountRows = { products: 'products', staff: 'staff', suppliers: 'suppliers', languages: 'languages', currencies: 'currencies', publish: 'publish_now', ai: 'ai_prompts' } as const satisfies Record<string, AmountKey>
type SwitchRow = keyof typeof switchRows
type AmountRow = keyof typeof amountRows
export type EntitlementRow = SwitchRow | AmountRow
export type RowEntitlements = Record<SwitchRow, boolean> & Record<AmountRow, number>

// The columns are int4, so an amount or a value past it is unreadable input, not a database error.
const int4 = z.number().int().min(0).max(2_147_483_647)
const currency = z.string().regex(/^[A-Z]{3}$/)
const money = z.strictObject({ amount: int4, currency })
export const planInput = z.strictObject({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(140),
  trialDays: z.number().int().min(0).max(90),
  prices: z
    .array(z.strictObject({ currency, monthly: money.nullable(), yearly: money.nullable() }))
    .max(10)
    .refine((prices) => new Set(prices.map((p) => p.currency)).size === prices.length, 'one row per currency'),
  entitlements: z.strictObject({
    domain: z.boolean(),
    offers: z.boolean(),
    suppliersOn: z.boolean(),
    powered: z.boolean(),
    aplus: z.boolean(),
    size: z.boolean(),
    products: int4,
    staff: int4,
    suppliers: int4,
    languages: int4,
    currencies: int4,
    publish: int4,
    ai: int4,
  }),
})
export type PlanInput = z.infer<typeof planInput>

export interface Money {
  amount: number
  currency: string
}

export type Margin = { kind: 'keep'; amount: Money; of: Money } | { kind: 'loss'; amount: Money } | { kind: 'unpriced' } | { kind: 'noFee' }

export interface PlanPrice {
  currency: string
  monthly: Money | null
  yearly: Money | null
  /** Null where the contract states no fee in this currency (no rate for it). */
  fee: Money | null
  converted: boolean
  margin: Margin
}

export type Refusal =
  | 'OWNERS_AND_ADMINS_ONLY' | 'PRICES_ONLY' | 'ABOVE_CEILING' | 'LAST_LIVE_PLAN' | 'UNPRICED_CURRENCY' | 'NEEDS_APPLY_TO'
  | 'NOT_FOUND' | 'INVALID_STATE' | 'INVALID_TARGET' | 'INVALID_CURRENCY' | 'INVALID_INPUT'
export type Permission = { allowed: true } | { allowed: false; reason: Refusal }
export type Result = { ok: true; id: string } | { ok: false; reason: Refusal; row?: EntitlementRow; currency?: string }

export interface PlanRowDto {
  id: string
  name: string
  description: string
  status: PlanStatus
  trialDays: number
  prices: PlanPrice[]
  stores: number
}

export interface PlansPage {
  items: PlanRowDto[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  chargedBy: string
  actions: { create: Permission }
}

export const maxPlansPage = 50

export interface PlanEditorDto {
  plan: (PlanRowDto & { entitlements: RowEntitlements }) | null
  ceilings: Record<AmountRow, number | null>
  powered: { allowed: boolean; note: 'contract' | 'firstYear' | null }
  currencies: string[]
  trials: number[]
  chargedBy: string
  permission: { edit: Permission; price: Permission }
  retireTargets: { id: string; name: string }[]
  retireDates: Date[]
}

export const planAudit = { createPlan: 'plan.created', updatePlan: 'plan.updated', makePlanLive: 'plan.made_live', retirePlan: 'plan.retired' } as const

// FIRST-RELEASE §7.2's trial choices; the house partner's 10 days is set by staff.
const trials = [0, 7, 14, 30]
// SAAS §6.3: stores moved at renewal hear 30 days ahead.
const noticeMs = 30 * 24 * 60 * 60 * 1000

const toRows = (e: Partial<Entitlements>): RowEntitlements => ({
  ...(Object.fromEntries(Object.entries(switchRows).map(([row, key]) => [row, e[key] === true])) as Record<SwitchRow, boolean>),
  ...(Object.fromEntries(Object.entries(amountRows).map(([row, key]) => [row, Number(e[key] ?? 0)])) as Record<AmountRow, number>),
})

const fromRows = (r: PlanInput['entitlements']): Entitlements => ({
  ...(Object.fromEntries(Object.entries(switchRows).map(([row, key]) => [key, r[row as SwitchRow] === true])) as Record<SwitchKey, boolean>),
  ...(Object.fromEntries(Object.entries(amountRows).map(([row, key]) => [key, Number(r[row as AmountRow])])) as Record<AmountKey, number>),
})

const firstOfMonths = (now: Date, count: number): Date[] =>
  Array.from({ length: count }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1)))

export interface PartnerPlansDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

/** `amount × rate`, the rate a decimal string, rounded half up: integer arithmetic only (AGENTS.md "Data"). */
const convert = (amount: number, rate: string): number => {
  const [whole = '0', fraction = ''] = rate.split('.')
  const scale = 10n ** BigInt(fraction.length)
  const scaled = BigInt(amount) * BigInt(whole + fraction)
  return Number((scaled * 2n + scale) / (scale * 2n))
}

export const createPartnerPlansService = ({ sql, caller, facts, activity, now }: PartnerPlansDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }
  const may = (permission: 'plans.write' | 'plans.price'): Permission =>
    partnerRoleHas(caller.user.role, permission) ? { allowed: true } : { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' }

  // The fee in a price's currency: the contract's own, or converted at its rate exactly (a
  // decimal string, scaled to integers; never a float). Unknown where the contract has no rate.
  const feeIn = (terms: ContractTerms, fee: number, currencyCode: string): { fee: Money | null; converted: boolean } => {
    const base = terms.fee_currency ?? currencyCode
    if (currencyCode === base) return { fee: { amount: fee, currency: currencyCode }, converted: false }
    const rate = terms.rates[currencyCode]
    return rate ? { fee: { amount: convert(fee, rate), currency: currencyCode }, converted: true } : { fee: null, converted: false }
  }

  const priceOf = (terms: ContractTerms, fee: number, p: PlanVersionPrice): PlanPrice => {
    const { fee: f, converted } = feeIn(terms, fee, p.currency)
    const monthly = p.monthly === null ? null : { amount: p.monthly, currency: p.currency }
    const margin: Margin =
      monthly === null
        ? { kind: 'unpriced' }
        : f === null
          ? { kind: 'noFee' }
          : monthly.amount < f.amount
            ? { kind: 'loss', amount: { amount: f.amount - monthly.amount, currency: p.currency } }
            : { kind: 'keep', amount: { amount: monthly.amount - f.amount, currency: p.currency }, of: monthly }
    return { currency: p.currency, monthly, yearly: p.yearly === null ? null : { amount: p.yearly, currency: p.currency }, fee: f, converted, margin }
  }

  const chargedBy = () => `DripFunnel for ${caller.partner.name}`

  // A plan's own fee, or for a new one, until DripFunnel sets it, the lowest the contract charges.
  const feeOf = async (tx: ScopedSql, row: CatalogueRow | null) => row?.fee ?? (await selectLowestFee(tx, partnerId)) ?? 0

  const dtoOf = async (tx: ScopedSql, terms: ContractTerms, row: CatalogueRow, prices: readonly PlanVersionPrice[]): Promise<PlanRowDto> => {
    const fee = await feeOf(tx, row)
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      status: row.status,
      trialDays: row.trial_days,
      prices: prices.map((p) => priceOf(terms, fee, p)),
      stores: row.stores,
    }
  }

  /** Null for a cursor that does not decode: refused, never read as the first page. */
  const plans = (afterCursor: string | null, limit: number): Promise<PlansPage | null> =>
    withScope(sql, context, async (tx) => {
      const size = Math.min(Math.max(Math.floor(limit), 1), maxPlansPage)
      const after = afterCursor === null ? undefined : decodeCursor(afterCursor)
      if (after === null) return null
      const rows = await selectCatalogue(tx, partnerId, after, size + 1)
      const page = rows.slice(0, size)
      const versions = await selectCurrentVersions(tx, page.map((r) => r.id))
      const terms = await selectContractTerms(tx, partnerId)
      const last = page[page.length - 1]
      return {
        items: await Promise.all(page.map((r) => dtoOf(tx, terms, r, versions.get(r.id)?.prices ?? []))),
        pageInfo: { hasNextPage: rows.length > size, endCursor: last ? encodeCursor({ occurredAt: last.created_at, id: last.id }) : null },
        chargedBy: chargedBy(),
        actions: { create: may('plans.write') },
      }
    })

  // What the partner sells in: its contract's currencies, or with no contract yet those its plans use.
  const currenciesOf = async (tx: ScopedSql, terms: ContractTerms): Promise<string[]> =>
    terms.fee_currency ? [terms.fee_currency, ...Object.keys(terms.rates)] : selectPlanCurrencies(tx, partnerId)

  const planEditor = (id: string | null): Promise<PlanEditorDto | null> =>
    withScope(sql, context, async (tx) => {
      const row = id === null ? null : await selectCataloguePlan(tx, partnerId, id)
      if (id !== null && !row) return null
      const terms = await selectContractTerms(tx, partnerId)
      const version = row ? (await selectCurrentVersions(tx, [row.id])).get(row.id) : undefined
      const ceilings = await selectCeilings(tx)
      return {
        plan: row ? { ...(await dtoOf(tx, terms, row, version?.prices ?? [])), entitlements: toRows(version?.entitlements ?? {}) } : null,
        ceilings: Object.fromEntries(Object.entries(amountRows).map(([r, key]) => [r, ceilings[key] ?? null])) as Record<AmountRow, number | null>,
        powered: { allowed: terms.powered_by_removable, note: terms.powered_by_note },
        currencies: await currenciesOf(tx, terms),
        trials,
        chargedBy: chargedBy(),
        permission: { edit: may('plans.write'), price: row ? may('plans.price') : may('plans.write') },
        retireTargets: (await selectLivePlanChoices(tx, partnerId, id)).map(({ id: target, name }) => ({ id: target, name })),
        retireDates: firstOfMonths(now(), 3),
      }
    })

  const quotePlanPrices = (id: string | null, prices: PlanInput['prices']): Promise<PlanPrice[]> =>
    withScope(sql, context, async (tx) => {
      const row = id === null ? null : await selectCataloguePlan(tx, partnerId, id)
      const terms = await selectContractTerms(tx, partnerId)
      const fee = await feeOf(tx, row)
      return prices.map((p) => priceOf(terms, fee, { currency: p.currency, monthly: p.monthly?.amount ?? null, yearly: p.yearly?.amount ?? null }))
    })

  // The ceilings and the contract's "Powered by" rule, named by row; the database refuses the same (0013).
  const aboveCeiling = async (tx: ScopedSql, e: PlanInput['entitlements']): Promise<EntitlementRow | null> => {
    const ceilings = await selectCeilings(tx)
    const over = (Object.entries(amountRows) as [AmountRow, AmountKey][]).find(([row, key]) => ceilings[key] !== undefined && e[row] > (ceilings[key] ?? 0))
    if (over) return over[0]
    return e.powered && !(await selectContractTerms(tx, partnerId)).powered_by_removable ? 'powered' : null
  }

  const entry = (action: string, plan: { id: string; name: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'partner_user',
    actorId: caller.user.id,
    actorLabel: `${caller.user.name} <${caller.user.email}>`,
    partnerId,
    target: { type: 'plan', id: plan.id, label: plan.name },
    reason,
    api: 'platform',
    visibility: 'partner',
    ...facts,
  })

  const by = { kind: 'partner_user' as const, label: caller.user.name }
  // Each amount is in its row's currency, and every row in a currency the contract states a fee in.
  const badCurrency = (input: PlanInput, terms: ContractTerms): string | null =>
    input.prices.find((p) => (p.monthly && p.monthly.currency !== p.currency) || (p.yearly && p.yearly.currency !== p.currency))?.currency ??
    (terms.fee_currency ? (input.prices.find((p) => p.currency !== terms.fee_currency && !terms.rates[p.currency])?.currency ?? null) : null)

  const pricesOf = (input: PlanInput): PlanVersionPrice[] => input.prices.map((p) => ({ currency: p.currency, monthly: p.monthly?.amount ?? null, yearly: p.yearly?.amount ?? null }))

  const createPlan = async (raw: unknown): Promise<Result> => {
    const refused = may('plans.write')
    if (!refused.allowed) return { ok: false, reason: refused.reason }
    const parsed = planInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = parsed.data
    return withScope(sql, context, async (tx): Promise<Result> => {
      const row = await aboveCeiling(tx, input.entitlements)
      if (row) return { ok: false, reason: 'ABOVE_CEILING', row }
      const bad = badCurrency(input, await selectContractTerms(tx, partnerId))
      if (bad) return { ok: false, reason: 'INVALID_CURRENCY', currency: bad }
      const id = await insertPlan(tx, { partnerId, name: input.name, description: input.description, status: 'draft', trialDays: input.trialDays, prices: pricesOf(input), entitlements: fromRows(input.entitlements) })
      await activity.record(tx, entry(planAudit.createPlan, { id, name: input.name }, null))
      return { ok: true, id }
    })
  }

  const updatePlan = async (id: string, raw: unknown, applyTo: 'new' | 'renewal' | null): Promise<Result> => {
    const parsed = planInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = parsed.data
    return withScope(sql, context, async (tx): Promise<Result> => {
      const row = await selectCataloguePlan(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      const terms = await selectContractTerms(tx, partnerId)
      // A retired plan is kept as its stores bought it; its move is retirePlan's.
      if (row.status === 'retired') return { ok: false, reason: 'INVALID_STATE' }
      if (!may('plans.write').allowed) {
        // Finance changes prices only (ACCESS.md §5.3): everything else must match the saved plan.
        const current = (await selectCurrentVersions(tx, [id])).get(id)
        const sameRest = row.name === input.name && (row.description ?? '') === input.description && row.trial_days === input.trialDays && JSON.stringify(toRows(current?.entitlements ?? {})) === JSON.stringify(input.entitlements)
        if (!may('plans.price').allowed) return { ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
        if (!sameRest) return { ok: false, reason: 'PRICES_ONLY' }
      }
      const over = await aboveCeiling(tx, input.entitlements)
      if (over) return { ok: false, reason: 'ABOVE_CEILING', row: over }
      const bad = badCurrency(input, terms)
      if (bad) return { ok: false, reason: 'INVALID_CURRENCY', currency: bad }
      if (row.stores > 0 && applyTo === null) return { ok: false, reason: 'NEEDS_APPLY_TO' }
      await updatePlanText(tx, id, partnerId, input.name, input.description)
      const version = await insertPlanVersion(tx, { planId: id, partnerId, trialDays: input.trialDays, prices: pricesOf(input), entitlements: fromRows(input.entitlements), by })
      await activity.record(tx, entry(planAudit.updatePlan, { id, name: input.name }, applyTo === 'renewal' ? 'everyone at renewal' : applyTo === 'new' ? 'new signups only' : null))
      if (applyTo === 'renewal') await moveAtRenewal(tx, id, version)
      return { ok: true, id }
    })
  }

  // In the same transaction as the change (0015 grants the schedule columns); each store hears 30 days ahead.
  const moveAtRenewal = async (tx: ScopedSql, planId: string, version: number) => {
    const moved = await scheduleSubscriptionMoves(tx, planId, { planId, version }, { atRenewalAfter: new Date(now().getTime() + noticeMs) })
    for (const m of moved) {
      await insertOutbox(tx, {
        kind: 'email',
        idempotencyKey: `plan-change-at-renewal:${m.store_id}:${planId}:${version}`,
        payload: { template: 'plan-change-at-renewal', storeId: m.store_id, planId, version, changeAt: m.change_at.toISOString() },
        partnerId,
        storeId: m.store_id,
      })
    }
  }

  const makePlanLive = (id: string): Promise<Result> =>
    withScope(sql, context, async (tx): Promise<Result> => {
      const row = await selectCataloguePlan(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      if (row.status !== 'draft') return { ok: false, reason: 'INVALID_STATE' }
      const prices = (await selectCurrentVersions(tx, [id])).get(id)?.prices ?? []
      const terms = await selectContractTerms(tx, partnerId)
      // The contract's currencies; with no contract yet, the draft's own (other plans never block it).
      const required = terms.fee_currency ? await currenciesOf(tx, terms) : prices.map((p) => p.currency)
      const unpriced = required.find((cur) => (prices.find((p) => p.currency === cur)?.monthly ?? null) === null)
      if (unpriced) return { ok: false, reason: 'UNPRICED_CURRENCY', currency: unpriced }
      await updatePlanStatus(tx, id, partnerId, 'live', null)
      await activity.record(tx, entry(planAudit.makePlanLive, row, null))
      return { ok: true, id }
    })

  const retireInput = z.discriminatedUnion('keep', [z.strictObject({ keep: z.literal(true) }), z.strictObject({ keep: z.literal(false), moveTo: z.string().uuid(), on: z.iso.datetime() })])

  const retirePlan = (id: string, raw: unknown): Promise<Result> => {
    const parsed = retireInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const input = parsed.data
    return withScope(sql, context, async (tx): Promise<Result> => {
      const row = await selectCataloguePlan(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      if (row.status !== 'live') return { ok: false, reason: 'INVALID_STATE' }
      // Locked, so two retirements at once cannot leave the partner with no Live plan.
      if ((await lockLivePlans(tx, partnerId)).length === 1) return { ok: false, reason: 'LAST_LIVE_PLAN' }
      const at = now()
      if (input.keep) {
        await updatePlanStatus(tx, id, partnerId, 'retired', { at, moveTo: null })
      } else {
        const candidate = input.moveTo === id ? null : await selectCataloguePlan(tx, partnerId, input.moveTo)
        const target = candidate?.status === 'live' ? candidate : null
        const on = new Date(input.on)
        if (!target || !firstOfMonths(at, 3).some((d) => d.getTime() === on.getTime())) return { ok: false, reason: 'INVALID_TARGET' }
        await updatePlanStatus(tx, id, partnerId, 'retired', { at: on, moveTo: target.id })
        await scheduleSubscriptionMoves(tx, id, { planId: target.id, version: target.version }, { on })
      }
      await activity.record(tx, entry(planAudit.retirePlan, row, input.keep ? 'stores keep it' : 'stores move on a date'))
      return { ok: true, id }
    })
  }

  return { plans, planEditor, quotePlanPrices, createPlan, updatePlan, makePlanLive, retirePlan }
}

export type PartnerPlansService = ReturnType<typeof createPartnerPlansService>
