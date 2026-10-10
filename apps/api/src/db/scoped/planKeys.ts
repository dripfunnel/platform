// Every setting a plan can carry (SAAS.md §6.1), in the pricing page's order (designs/DF Store Pricing).
// `switch` holds `enabled`; `amount` is a limit or a monthly allowance; `choice` is an index into `choices`.
// `enforced` is false while the feature behind the row isn't built: the value is stored, the console
// says Planned, and nothing checks it yet. Migration 0070 inserts the same keys into `plan_key`.

export const UNLIMITED = 2_147_483_647

export const planGroups = ['catalogue', 'payments', 'team', 'abroad', 'shipping', 'storefront', 'reports', 'support'] as const
export type PlanGroup = (typeof planGroups)[number]

interface Def {
  key: string
  kind: 'switch' | 'amount' | 'choice'
  group: PlanGroup
  enforced: boolean
  monthly?: true
  choices?: readonly string[]
}

const sw = <const K extends string>(key: K, group: PlanGroup, enforced = false) => ({ key, kind: 'switch', group, enforced }) as const
const amount = <const K extends string>(key: K, group: PlanGroup, enforced = false, monthly?: true) => ({ key, kind: 'amount', group, enforced, ...(monthly ? { monthly } : {}) }) as const
const choice = <const K extends string, const C extends readonly string[]>(key: K, group: PlanGroup, choices: C) => ({ key, kind: 'choice', group, enforced: false, choices }) as const

export const planKeyDefs = [
  amount('products', 'catalogue', true),
  amount('photos_per_product', 'catalogue'),
  amount('versions_per_product', 'catalogue'),
  amount('collections', 'catalogue'),
  sw('size_charts', 'catalogue', true),
  sw('badges', 'catalogue', true),
  sw('faqs_related', 'catalogue', true),
  sw('aplus', 'catalogue', true),
  sw('product_video', 'catalogue', true),
  sw('import_spreadsheet', 'catalogue', true),
  sw('import_shopify', 'catalogue', true),
  choice('ai_mode', 'catalogue', ['ownKey', 'included', 'allowance']),
  amount('ai_prompts', 'catalogue', true, true),
  amount('payment_gateways', 'payments'),
  sw('offers', 'payments', true),
  sw('group_offers', 'payments'),
  sw('offer_results', 'payments'),
  amount('staff', 'team', true),
  sw('manager_role', 'team'),
  sw('suppliers_enabled', 'team', true),
  amount('suppliers', 'team', true),
  sw('supplier_approval', 'team'),
  sw('supplier_packing', 'team'),
  amount('markets', 'abroad'),
  amount('currencies', 'abroad', true),
  amount('languages', 'abroad', true),
  sw('price_adjustment', 'abroad'),
  sw('fixed_market_prices', 'abroad'),
  sw('market_domains', 'abroad'),
  sw('duties_taxes', 'abroad'),
  amount('stock_locations', 'shipping'),
  amount('couriers', 'shipping'),
  sw('courier_rates', 'shipping'),
  amount('bandwidth_gb', 'storefront'),
  sw('extra_bandwidth', 'storefront'),
  sw('custom_domain', 'storefront', true),
  sw('powered_by_removal', 'storefront', true),
  amount('publish_now', 'storefront', true, true),
  amount('history_days', 'storefront'),
  choice('cart_reminders', 'storefront', ['youSend', 'onePerCart', 'automatic']),
  sw('blog', 'storefront'),
  sw('reports_sales', 'reports', true),
  sw('reports_export', 'reports', true),
  sw('reports_custom', 'reports', true),
  choice('support_level', 'support', ['helpCentre', 'email', 'chat', 'priority', 'manager']),
  sw('uptime_guarantee', 'support'),
  sw('white_label', 'support'),
  sw('many_stores', 'support'),
  sw('sso_api', 'support'),
  sw('onboarding', 'support'),
] as const satisfies readonly Def[]

export type PlanKeyDef = (typeof planKeyDefs)[number]
type Of<K extends PlanKeyDef['kind']> = Extract<PlanKeyDef, { kind: K }>['key']
export type SwitchKey = Of<'switch'>
export type AmountKey = Of<'amount'>
export type ChoiceKey = Of<'choice'>
export type PlanKey = PlanKeyDef['key']
/** A limit or allowance, or a choice's index: what the `amount` column holds. */
export type NumberKey = AmountKey | ChoiceKey
export type Entitlements = Record<SwitchKey, boolean> & Record<NumberKey, number>

const keysOf = <K extends PlanKeyDef['kind']>(kind: K): Of<K>[] => planKeyDefs.filter((d) => d.kind === kind).map((d) => d.key) as Of<K>[]
export const switchKeys = keysOf('switch')
export const amountKeys = keysOf('amount')
export const choiceKeys = keysOf('choice')
export const numberKeys: NumberKey[] = [...amountKeys, ...choiceKeys]

/** Rows added after the first catalogue that are checked on the server: plans written before them keep today's behaviour, so they start on (migration 0070). */
export const permissiveBackfill: readonly SwitchKey[] = ['badges', 'faqs_related', 'product_video', 'import_spreadsheet', 'import_shopify']

/** What a plan version written before a row existed gets. Planned rows are never checked, so off and zero are safe; a checked new row starts on. */
export const backfillOf = (def: PlanKeyDef): { enabled: boolean | null; amount: number | null } =>
  def.kind === 'switch' ? { enabled: (permissiveBackfill as readonly string[]).includes(def.key), amount: null } : { enabled: null, amount: 0 }

/** Every key at its backfill value; a plan's own values go over it. A new plan in the console starts from the editor's blanks, not from this. */
export const defaultEntitlements = (): Entitlements =>
  Object.fromEntries(planKeyDefs.map((d) => [d.key, d.kind === 'switch' ? backfillOf(d).enabled : backfillOf(d).amount])) as Entitlements
