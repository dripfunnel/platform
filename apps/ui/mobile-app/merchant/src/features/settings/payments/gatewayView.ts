import type { Gateway } from '../../../api/settingsPayments'

export type KeyName = 'keyId' | 'keySecret' | 'webhookSecret' | 'appId' | 'secretKey' | 'clientId' | 'clientSecret' | 'clientVersion' | 'webhookUsername' | 'webhookPassword' | 'webhookId'

/** What each provider's owner pastes (THIRD-PARTY-ACCESS §3.1), each by its own name; secrets are masked. Stripe pastes nothing: it connects on the portal. */
export const keyFields: Readonly<Record<string, readonly { name: KeyName; secret: boolean }[]>> = {
  razorpay: [
    { name: 'keyId', secret: false },
    { name: 'keySecret', secret: true },
    { name: 'webhookSecret', secret: true },
  ],
  cashfree: [
    { name: 'appId', secret: false },
    { name: 'secretKey', secret: true },
  ],
  phonepe: [
    { name: 'clientId', secret: false },
    { name: 'clientSecret', secret: true },
    { name: 'clientVersion', secret: false },
    { name: 'webhookUsername', secret: false },
    { name: 'webhookPassword', secret: true },
  ],
  paypal: [
    { name: 'clientId', secret: false },
    { name: 'clientSecret', secret: true },
    { name: 'webhookId', secret: false },
  ],
}

/** The longest bank details the API keeps (apps/api src/engine/modules/checkout/setup.ts). */
export const bankDetailsMax = 1000

export const isConnected = (gateway: Gateway): boolean => gateway.connections.length > 0

export type Standing = 'live' | 'test' | 'off' | 'unavailable'

/** Live; test keys only (the preview storefront's); not connected; or one the platform has not set up, which has nothing to press. */
export const standingOf = (gateway: Gateway): Standing => (gateway.live ? 'live' : isConnected(gateway) ? 'test' : gateway.connectable ? 'off' : 'unavailable')

export type GatewayAction = 'connect' | 'changeKeys' | 'setUp' | 'changeDetails' | 'turnOff' | 'disconnect'

/** What a way to pay offers, in the order its menu lists them. */
export const actionsFor = (gateway: Gateway): GatewayAction[] => {
  if (gateway.kind === 'other') return gateway.live ? [...(gateway.provider === 'bank_transfer' ? (['changeDetails'] as const) : []), 'turnOff'] : ['setUp']
  if (isConnected(gateway)) return [...(keyFields[gateway.provider] ? (['changeKeys'] as const) : []), 'disconnect']
  return gateway.connectable ? ['connect'] : []
}

/** The typed values as the API's key input: every field the provider has, trimmed. */
export const keysOf = (provider: string, values: Readonly<Partial<Record<KeyName, string>>>): Record<string, string> =>
  Object.fromEntries((keyFields[provider] ?? []).map((field) => [field.name, (values[field.name] ?? '').trim()]))

export const keysComplete = (provider: string, values: Readonly<Partial<Record<KeyName, string>>>): boolean => Object.values(keysOf(provider, values)).every((value) => value !== '')
