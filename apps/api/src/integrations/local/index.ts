import type postgres from 'postgres'
import type { SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { selectLocalExpectedRecords } from '#db/scoped/partnerDomains'
import type { CloudflareApi } from '../cloudflare/api'
import type { DnsLookup } from '../dns/doh'
import type { SesApi } from '../ses/index'

// Local stand-ins for the last step of email, SMS, DNS and custom hostnames (docs/setup/local.md §6.1). Config refuses
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
