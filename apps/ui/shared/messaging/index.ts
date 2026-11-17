// SMS and WhatsApp accounts as both consoles show them: a partner's own, and DripFunnel's in the admin console
// (THIRD-PARTY-ACCESS §4). The shapes are the API's, checked here so a form says what's wrong before sending.

/** What the platform texts, each one DLT template in India, in the API's order. */
export const smsMessages = ['code.second_factor', 'code.verify_phone', 'code.shopper_sign_in', 'order.confirmed', 'order.shipped', 'order.delivered', 'rider.invited'] as const
export type SmsMessage = (typeof smsMessages)[number]
export const smsProviders = ['msg91', 'twilio', 'sns'] as const
export type SmsProvider = (typeof smsProviders)[number]
export const smsRoutes = ['india', 'rest'] as const
export type SmsRoute = (typeof smsRoutes)[number]
/** Each route's providers, in the order a route without a pick takes them. */
export const routeProviders: Record<SmsRoute, readonly [SmsProvider, SmsProvider]> = { india: ['msg91', 'sns'], rest: ['twilio', 'sns'] }

export const smsShapes = {
  authKey: /^[A-Za-z0-9]{16,64}$/,
  templateId: /^[A-Za-z0-9_-]{1,64}$/,
  accountSid: /^AC[0-9a-f]{32}$/,
  authToken: /^[0-9a-f]{32}$/,
  messagingServiceSid: /^MG[0-9a-f]{32}$/,
  accessKeyId: /^(AKIA|ASIA)[A-Z0-9]{16}$/,
  secretAccessKey: /^[A-Za-z0-9/+]{40}$/,
  region: /^[a-z]{2}(-[a-z]+)+-\d$/,
  senderId: /^[A-Za-z0-9]{3,11}$/,
  entityId: /^\d{10,30}$/,
}

/** A saved SMS account as either API shows it back: never its secret. */
export interface SavedSmsAccount {
  provider: SmsProvider
  /** India's seven template ids (and SNS's DLT header and entity) are in; null for Twilio, which has none. */
  templatesComplete: boolean | null
}

/** Whether a saved account can send every message on the route: India needs its DLT templates. */
export const servesRoute = (account: SavedSmsAccount, route: SmsRoute): boolean =>
  route === 'rest' ? account.provider !== 'msg91' : account.provider !== 'twilio' && account.templatesComplete === true

/** The saved account that sends a route: the chosen provider's, else the first of the route's that serves it (`saas/sms` `accountForRoute`). */
export const accountForRoute = <A extends SavedSmsAccount>(accounts: readonly A[], route: SmsRoute, choice: string | null): A | undefined =>
  [choice, ...routeProviders[route]].map((p) => accounts.find((a) => a.provider === p)).find((a): a is A => a !== undefined && servesRoute(a, route))

/** Whose account sends, by the API's rule (`saas/sms` `senderOf`): DripFunnel's only where it's there and chosen, or nothing else is. */
export const senderOf = (choice: string | null, hasOwn: boolean, ours: boolean): 'own' | 'dripfunnel' | null =>
  ours && (choice === 'dripfunnel' || !hasOwn) ? 'dripfunnel' : hasOwn ? 'own' : null

/** The messages a WhatsApp account names a template for, in the API's order: the portal code first. */
export const whatsAppMessages = ['code.portal', 'cart.reminder', 'cart.reminder_code'] as const
export type WhatsAppMessage = (typeof whatsAppMessages)[number]

export const whatsAppShapes = {
  id: /^\d{5,25}$/,
  token: /^[A-Za-z0-9._-]{20,2048}$/,
  language: /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/,
  template: /^[a-z0-9_]{1,512}$/,
}

/** What Meta refused: the token, the number, the business account, or the template for one message. */
export type WhatsAppRejection = { problem: 'token' | 'phone_number' | 'business_account' } | { problem: 'template'; template: WhatsAppMessage }

export const rejectionOf = (r: { problem: string | null; template: string | null }): WhatsAppRejection | null => {
  if (r.problem === 'token' || r.problem === 'phone_number' || r.problem === 'business_account') return { problem: r.problem }
  const template = whatsAppMessages.find((m) => m === r.template)
  return r.problem === 'template' && template ? { problem: 'template', template } : null
}

/** On needs an account naming `code.portal` whose last check said Working (ACCESS §4). */
export const servesCodes = (account: { status: string; templates: readonly { message: string; name: string | null }[] }): boolean =>
  account.status === 'ok' && account.templates.some((t) => t.message === 'code.portal' && t.name)
