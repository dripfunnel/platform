import type postgres from 'postgres'
import type { CourierDirectory, CourierProvider } from '#core/couriers'
import type { SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { selectLocalExpectedRecords } from '#db/scoped/partnerDomains'
import type { CloudflareApi } from '../cloudflare/api'
import type { DnsLookup } from '../dns/doh'
import type { SesApi } from '../ses/index'

// Local stand-ins for the last step of email, SMS, couriers, DNS and custom hostnames (docs/setup/local.md §6.1). Config refuses
// them anywhere but localhost (core/config.ts), so the personal data they print never leaves the developer's own terminal.

/** The marker `pnpm dev` (scripts/local/dev.ts) reads to show a message and keep it in apps/api/.local-mail/. */
export const localMessageMarker = '[local-message]'

export type LocalMessage = { kind: 'email'; to: readonly string[]; from: string; subject: string; text: string } | { kind: 'sms'; to: string; text: string }

const print = (message: LocalMessage) => console.log(`${localMessageMarker} ${JSON.stringify(message)}`)

/** SES's last step on this machine: the rendered email, as SES would have taken it. */
export const localEmail = (): SesApi => ({
  send: async (email) => {
    print({ kind: 'email', to: email.to, from: email.from, subject: email.subject, text: email.text })
    return { messageId: `local-${crypto.randomUUID()}` }
  },
})

/** MSG91's or Twilio's last step on this machine: the composed text. */
export const localSms = (): SmsSender => ({
  send: async (sms) => {
    print({ kind: 'sms', to: sms.to, text: sms.text })
    return { providerId: `local-${crypto.randomUUID()}` }
  },
})

const isLocalName = (host: string) => host.toLowerCase().endsWith('.localhost')

/**
 * A `*.localhost` name answers with what its partner's domain record expects, so the real domain check marks it live
 * as DNS would on dev. Every other name goes to the real resolver.
 */
export const localDns = (sql: postgres.Sql, resolver: DnsLookup): DnsLookup => ({
  resolve: (host, type, signal) =>
    isLocalName(host) ? withSystemScope(sql, (tx) => selectLocalExpectedRecords(tx, host.toLowerCase(), type)) : resolver.resolve(host, type, signal),
})

/** A `*.localhost` name is live at once and never reaches Cloudflare for SaaS. Every other name goes to the real client. */
export const localCloudflare = (client: CloudflareApi): CloudflareApi => ({
  ensureHostname: async (hostname) =>
    isLocalName(hostname) ? { id: `local-${hostname}`, hostname, status: 'active', ssl: { status: 'active' } } : client.ensureHostname(hostname),
  removeHostname: async (hostname) => (isLocalName(hostname) ? undefined : client.removeHostname(hostname)),
})

// What the stand-in charges: a base and a step per started 500 g, in the store's own currency.
const localTariff: Record<CourierProvider, { currency: string; base: bigint; step: bigint; service: string; days: [number, number] }> = {
  shiprocket: { currency: 'INR', base: 4000n, step: 2000n, service: 'Local surface', days: [3, 5] },
  usps: { currency: 'USD', base: 550n, step: 110n, service: 'Local ground', days: [3, 5] },
  ups: { currency: 'USD', base: 750n, step: 130n, service: 'Local ground', days: [2, 4] },
  fedex: { currency: 'USD', base: 850n, step: 150n, service: 'Local express', days: [1, 3] },
}

/**
 * Every partner has both accounts, quoting a fixed tariff within the courier's own country, so checkout and Settings ›
 * Shipping work locally without Shiprocket or EasyPost (#275 sets the real accounts).
 */
export const localCouriers = (): CourierDirectory => ({
  forPartner: async () => ({
    accounts: new Set(['shiprocket', 'easypost'] as const),
    gateway: {
      quote: async (provider, parcel) => {
        const tariff = localTariff[provider]
        if (parcel.from.country !== parcel.to.country || parcel.from.country !== (provider === 'shiprocket' ? 'IN' : 'US')) return null
        const steps = BigInt(Math.max(1, Math.ceil(parcel.weightGrams / 500)))
        return { amount: { amount: tariff.base + tariff.step * (steps - 1n), currency: tariff.currency }, service: tariff.service, minDays: tariff.days[0], maxDays: tariff.days[1] }
      },
    },
  }),
})
