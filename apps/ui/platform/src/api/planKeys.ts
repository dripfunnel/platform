// The plan settings, in the pricing page's order. Mirrors apps/api/src/db/scoped/planKeys.ts; a test
// (planKeys.test.ts) fails when the two differ, so a key added there is added here.

export const UNLIMITED = 2_147_483_647

export const planGroups = ['catalogue', 'payments', 'team', 'abroad', 'shipping', 'storefront', 'reports', 'support'] as const
export type PlanGroup = (typeof planGroups)[number]

export interface PlanKeyDef {
  key: string
  kind: 'switch' | 'amount' | 'choice'
  group: PlanGroup
  enforced: boolean
  monthly: boolean
  choices: readonly string[]
}

export const planKeyDefs: readonly PlanKeyDef[] = [
  { key: 'products', kind: 'amount', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'photos_per_product', kind: 'amount', group: 'catalogue', enforced: false, monthly: false, choices: [] },
  { key: 'versions_per_product', kind: 'amount', group: 'catalogue', enforced: false, monthly: false, choices: [] },
  { key: 'collections', kind: 'amount', group: 'catalogue', enforced: false, monthly: false, choices: [] },
  { key: 'size_charts', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'badges', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'faqs_related', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'aplus', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'product_video', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'import_spreadsheet', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'import_shopify', kind: 'switch', group: 'catalogue', enforced: true, monthly: false, choices: [] },
  { key: 'ai_mode', kind: 'choice', group: 'catalogue', enforced: false, monthly: false, choices: ['ownKey', 'included', 'allowance'] },
  { key: 'ai_prompts', kind: 'amount', group: 'catalogue', enforced: true, monthly: true, choices: [] },
  { key: 'payment_gateways', kind: 'amount', group: 'payments', enforced: false, monthly: false, choices: [] },
  { key: 'offers', kind: 'switch', group: 'payments', enforced: true, monthly: false, choices: [] },
  { key: 'live_offers', kind: 'amount', group: 'payments', enforced: true, monthly: false, choices: [] },
  { key: 'group_offers', kind: 'switch', group: 'payments', enforced: true, monthly: false, choices: [] },
  { key: 'offer_results', kind: 'switch', group: 'payments', enforced: true, monthly: false, choices: [] },
  { key: 'staff', kind: 'amount', group: 'team', enforced: true, monthly: false, choices: [] },
  { key: 'manager_role', kind: 'switch', group: 'team', enforced: false, monthly: false, choices: [] },
  { key: 'suppliers_enabled', kind: 'switch', group: 'team', enforced: true, monthly: false, choices: [] },
  { key: 'suppliers', kind: 'amount', group: 'team', enforced: true, monthly: false, choices: [] },
  { key: 'supplier_approval', kind: 'switch', group: 'team', enforced: false, monthly: false, choices: [] },
  { key: 'supplier_packing', kind: 'switch', group: 'team', enforced: false, monthly: false, choices: [] },
  { key: 'markets', kind: 'amount', group: 'abroad', enforced: false, monthly: false, choices: [] },
  { key: 'currencies', kind: 'amount', group: 'abroad', enforced: true, monthly: false, choices: [] },
  { key: 'languages', kind: 'amount', group: 'abroad', enforced: true, monthly: false, choices: [] },
  { key: 'price_adjustment', kind: 'switch', group: 'abroad', enforced: false, monthly: false, choices: [] },
  { key: 'fixed_market_prices', kind: 'switch', group: 'abroad', enforced: false, monthly: false, choices: [] },
  { key: 'market_domains', kind: 'switch', group: 'abroad', enforced: false, monthly: false, choices: [] },
  { key: 'duties_taxes', kind: 'switch', group: 'abroad', enforced: false, monthly: false, choices: [] },
  { key: 'stock_locations', kind: 'amount', group: 'shipping', enforced: false, monthly: false, choices: [] },
  { key: 'couriers', kind: 'amount', group: 'shipping', enforced: false, monthly: false, choices: [] },
  { key: 'courier_rates', kind: 'switch', group: 'shipping', enforced: false, monthly: false, choices: [] },
  { key: 'bandwidth_gb', kind: 'amount', group: 'storefront', enforced: false, monthly: false, choices: [] },
  { key: 'extra_bandwidth', kind: 'switch', group: 'storefront', enforced: false, monthly: false, choices: [] },
  { key: 'custom_domain', kind: 'switch', group: 'storefront', enforced: true, monthly: false, choices: [] },
  { key: 'powered_by_removal', kind: 'switch', group: 'storefront', enforced: true, monthly: false, choices: [] },
  { key: 'publish_now', kind: 'amount', group: 'storefront', enforced: true, monthly: true, choices: [] },
  { key: 'history_days', kind: 'amount', group: 'storefront', enforced: false, monthly: false, choices: [] },
  { key: 'cart_reminders', kind: 'choice', group: 'storefront', enforced: true, monthly: false, choices: ['youSend', 'onePerCart', 'automatic'] },
  { key: 'blog', kind: 'switch', group: 'storefront', enforced: false, monthly: false, choices: [] },
  { key: 'reports_sales', kind: 'switch', group: 'reports', enforced: true, monthly: false, choices: [] },
  { key: 'reports_export', kind: 'switch', group: 'reports', enforced: true, monthly: false, choices: [] },
  { key: 'reports_custom', kind: 'switch', group: 'reports', enforced: true, monthly: false, choices: [] },
  { key: 'support_level', kind: 'choice', group: 'support', enforced: false, monthly: false, choices: ['helpCentre', 'email', 'chat', 'priority', 'manager'] },
  { key: 'uptime_guarantee', kind: 'switch', group: 'support', enforced: false, monthly: false, choices: [] },
  { key: 'white_label', kind: 'switch', group: 'support', enforced: false, monthly: false, choices: [] },
  { key: 'many_stores', kind: 'switch', group: 'support', enforced: false, monthly: false, choices: [] },
  { key: 'sso_api', kind: 'switch', group: 'support', enforced: false, monthly: false, choices: [] },
  { key: 'onboarding', kind: 'switch', group: 'support', enforced: false, monthly: false, choices: [] },
]
