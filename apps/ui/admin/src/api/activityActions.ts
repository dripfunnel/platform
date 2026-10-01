// The action codes (LOGGING.md §3, §4): the draft contract offered to #38 (decided on #44).
// Each code's words are messages.activity.actions[code]; a code with no message fails a test.
export const activityLevels = ['admin', 'partner', 'store', 'storefront', 'system', 'security'] as const
export type ActivityLevel = (typeof activityLevels)[number]

export type ActivityCategory = 'auth' | 'write' | 'support' | 'system' | 'security'

export const activityActions = {
  'staff.signed_in': { level: 'admin', category: 'auth' },
  'staff.signed_out': { level: 'admin', category: 'auth' },
  'staff.sign_in_failed': { level: 'admin', category: 'auth' },
  'staff.reauthenticated': { level: 'admin', category: 'auth' },
  'partner.created': { level: 'admin', category: 'write' },
  'partner.approved': { level: 'admin', category: 'write' },
  'partner.sent_back': { level: 'admin', category: 'write' },
  'partner.paused': { level: 'admin', category: 'write' },
  'partner.resumed': { level: 'admin', category: 'write' },
  'store.suspended': { level: 'admin', category: 'write' },
  'store.restored': { level: 'admin', category: 'write' },
  'store.trial_extended': { level: 'admin', category: 'write' },
  'job.retried': { level: 'admin', category: 'write' },
  'job.undone': { level: 'admin', category: 'write' },
  'staff.invited': { level: 'admin', category: 'write' },
  'staff.role_changed': { level: 'admin', category: 'write' },
  'impersonation.started': { level: 'admin', category: 'support' },
  'impersonation.extended': { level: 'admin', category: 'support' },
  'impersonation.ended': { level: 'admin', category: 'support' },
  'setup_session.started': { level: 'admin', category: 'support' },
  'setup_session.ended': { level: 'admin', category: 'support' },
  'customer.viewed': { level: 'admin', category: 'support' },
  'activity.exported': { level: 'admin', category: 'write' },
  'partner_user.signed_in': { level: 'partner', category: 'auth' },
  'branding.updated': { level: 'partner', category: 'write' },
  'domain.added': { level: 'partner', category: 'write' },
  'plan.created': { level: 'partner', category: 'write' },
  'plan.price_changed': { level: 'partner', category: 'write' },
  'merchant.plan_changed': { level: 'partner', category: 'write' },
  'partner.submitted': { level: 'partner', category: 'write' },
  'support_session.started': { level: 'partner', category: 'support' },
  'person.signed_in': { level: 'store', category: 'auth' },
  'product.updated': { level: 'store', category: 'write' },
  'products.created': { level: 'store', category: 'write' },
  'stock.updated': { level: 'store', category: 'write' },
  'order.refunded': { level: 'store', category: 'write' },
  'storefront.published': { level: 'store', category: 'write' },
  'api_key.created': { level: 'store', category: 'write' },
  'vendor.invited': { level: 'store', category: 'write' },
  'customer.signed_up': { level: 'storefront', category: 'auth' },
  'customer.signed_in': { level: 'storefront', category: 'auth' },
  'customer.sign_in_failed': { level: 'storefront', category: 'auth' },
  'customer.password_reset': { level: 'storefront', category: 'auth' },
  'customer.address_changed': { level: 'storefront', category: 'write' },
  'customer.order_placed': { level: 'storefront', category: 'write' },
  'provisioning.step_failed': { level: 'system', category: 'system' },
  'billing.payment_failed': { level: 'system', category: 'system' },
  'security.sign_in_blocked': { level: 'security', category: 'security' },
  'security.tenant_crossing': { level: 'security', category: 'security' },
  'security.authorization_denied': { level: 'security', category: 'security' },
} as const satisfies Record<string, { level: ActivityLevel; category: ActivityCategory }>

export type ActionCode = keyof typeof activityActions

export const actionCodes = Object.keys(activityActions) as ActionCode[]

export const levelOf = (code: ActionCode): ActivityLevel => activityActions[code].level

// The customer's Activity tab offers only a shopper's own account events (decided on #44).
export const shopperActions: readonly ActionCode[] = actionCodes.filter((code) => levelOf(code) === 'storefront')
