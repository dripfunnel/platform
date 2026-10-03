import type { HostStatus, PartnerDomainRow } from '#db/schema/saas'
import type { DnsLookup, DnsRecordType } from '#integrations/dns/doh'
import { nameToResolve, recordMatches, type RecordPurpose } from './records'

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


export const checkDomain = async (domain: Pick<PartnerDomainRow, 'host' | 'status' | 'record_type' | 'expected'>, lookup: DnsLookup, signal: AbortSignal): Promise<DomainCheck> => {
  const found = await lookup.resolve(nameToResolve(domain.host), domain.record_type, signal)
  return judge(domain.status, domain.expected, found)
}

export interface RecordToCheck {
  id: string
  purpose: RecordPurpose
  record_type: DnsRecordType
  name: string
  expected: string
}

/**
 * An address with several records (the email sender's SPF, DKIM and DMARC, and every address's
 * ownership token) is live once every one matches; any record pointing elsewhere fails it
 * (broken once it was live); otherwise it waits.
 */
export const checkRecords = async (
  previous: HostStatus,
  records: readonly RecordToCheck[],
  lookup: DnsLookup,
  signal: AbortSignal,
): Promise<{ status: HostStatus; found: string | null; records: { id: string; found: string | null }[] }> => {
  const results: { id: string; status: 'live' | 'waiting' | 'failed'; found: string | null }[] = []
  for (const record of records) {
    const values = await lookup.resolve(record.name, record.record_type, signal)
    const match = values.find((v) => recordMatches(record.purpose, record.expected, v))
    results.push({ id: record.id, status: match ? 'live' : values.length === 0 ? 'waiting' : 'failed', found: match ?? values[0] ?? null })
  }
  const wasLive = previous === 'live' || previous === 'broken'
  // No records means nothing was proved: never live (an empty `every` would say it was).
  if (results.length === 0) return { status: wasLive ? 'broken' : 'waiting', found: null, records: [] }
  const status: HostStatus = results.every((r) => r.status === 'live') ? 'live' : wasLive ? 'broken' : results.some((r) => r.status === 'failed') ? 'failed' : 'waiting'
  return { status, found: results[0]?.found ?? null, records: results.map((r) => ({ id: r.id, found: r.found })) }
}
