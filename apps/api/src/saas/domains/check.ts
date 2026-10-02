import type { HostStatus, PartnerDomainRow } from '#db/schema/saas'
import type { DnsLookup } from '#integrations/dns/doh'

// SAAS.md §8: waiting for DNS → live once the record points at us; a record that points
// elsewhere fails, and one that stops pointing at us after being live is broken. Certificate
// issuance (verifying, issuing) arrives with the Cloudflare for SaaS integration.

export interface DomainCheck {
  status: HostStatus
  found: string | null
}

export const judge = (previous: HostStatus, expected: string, found: string[]): DomainCheck => {
  const match = found.find((value) => value.toLowerCase() === expected.toLowerCase())
  if (match) return { status: 'live', found: match }
  const other = found[0] ?? null
  if (other === null) return { status: previous === 'live' || previous === 'broken' ? 'broken' : 'waiting', found: null }
  return { status: previous === 'live' || previous === 'broken' ? 'broken' : 'failed', found: other }
}

/** A wildcard is checked through a probe name under it, since DNS answers for names, not patterns. */
export const nameToResolve = (host: string): string => (host.startsWith('*.') ? `df-probe.${host.slice(2)}` : host)

export const checkDomain = async (domain: Pick<PartnerDomainRow, 'host' | 'status' | 'record_type' | 'expected'>, lookup: DnsLookup, signal: AbortSignal): Promise<DomainCheck> => {
  const found = await lookup.resolve(nameToResolve(domain.host), domain.record_type, signal)
  return judge(domain.status, domain.expected, found)
}
