import type { DomainKind, HostStatus, PartnerDomainRow } from '../schema/saas'
import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'

// The partner's four addresses with their records, and its merchants' own domains
// (ui/platform/FIRST-RELEASE.md §9; card #197). RLS holds every read to the partner (0020).

export interface PartnerDomainRecordRow {
  id: string
  domain_id: string
  position: number
  purpose: 'pointer' | 'ownership' | 'spf' | 'dkim' | 'dmarc'
  record_type: 'CNAME' | 'TXT' | 'A'
  name: string
  expected: string
  found: string | null
  checked_at: Date | null
}

export const selectPartnerDomainsWithRecords = async (tx: ScopedSql, partnerId: string): Promise<{ domain: PartnerDomainRow; records: PartnerDomainRecordRow[] }[]> => {
  const domains = await tx<PartnerDomainRow[]>`select * from partner_domain where partner_id = ${partnerId} order by kind`
  const records = await tx<PartnerDomainRecordRow[]>`
    select id, domain_id, position, purpose, record_type, name, expected, found, checked_at
    from partner_domain_record where partner_id = ${partnerId} order by domain_id, position
  `
  return domains.map((domain) => ({ domain, records: records.filter((r) => r.domain_id === domain.id) }))
}

export const selectDomainRecords = (tx: ScopedSql, domainId: string): Promise<PartnerDomainRecordRow[]> =>
  tx<PartnerDomainRecordRow[]>`
    select id, domain_id, position, purpose, record_type, name, expected, found, checked_at
    from partner_domain_record where domain_id = ${domainId} order by position
  `

/** What a `*.localhost` record is expected to hold, for the local DNS stand-in (system scope; never another name). */
export const selectLocalExpectedRecords = async (tx: ScopedSql, name: string, recordType: string): Promise<string[]> =>
  name.endsWith('.localhost')
    ? (await tx<{ expected: string }[]>`select expected from partner_domain_record where lower(name) = lower(${name}) and record_type = ${recordType} order by position`).map((r) => r.expected)
    : []

export interface NewPartnerAddress {
  partnerId: string
  kind: DomainKind
  host: string
  records: readonly { purpose: PartnerDomainRecordRow['purpose']; recordType: PartnerDomainRecordRow['record_type']; name: string; expected: string }[]
}

/** The address, waiting, and its records; the first record is the row's own (0007's columns). */
export const insertPartnerAddress = async (tx: ScopedSql, a: NewPartnerAddress): Promise<string> => {
  const first = a.records[0]
  if (!first) throw new Error('partner_domain: an address has at least one record')
  const id = crypto.randomUUID()
  await tx`
    insert into partner_domain (id, partner_id, kind, host, status, record_type, expected)
    values (${id}, ${a.partnerId}, ${a.kind}, ${a.host}, 'waiting', ${first.recordType}, ${first.expected})
  `
  for (const [position, r] of a.records.entries()) {
    await tx`
      insert into partner_domain_record (domain_id, partner_id, position, purpose, record_type, name, expected)
      values (${id}, ${a.partnerId}, ${position}, ${r.purpose}, ${r.recordType}, ${r.name}, ${r.expected})
    `
  }
  return id
}

/** For the seed and data repairs: an existing address's records, as found or not. */
export const insertDomainRecords = async (
  tx: ScopedSql,
  domainId: string,
  partnerId: string,
  records: readonly { purpose: PartnerDomainRecordRow['purpose']; recordType: PartnerDomainRecordRow['record_type']; name: string; expected: string; found: string | null }[],
  checkedAt: Date | null,
): Promise<void> => {
  for (const [position, r] of records.entries()) {
    await tx`
      insert into partner_domain_record (domain_id, partner_id, position, purpose, record_type, name, expected, found, checked_at)
      values (${domainId}, ${partnerId}, ${position}, ${r.purpose}, ${r.recordType}, ${r.name}, ${r.expected}, ${r.found}, ${checkedAt})
    `
  }
}

export const hostClaimedElsewhere = async (tx: ScopedSql, host: string): Promise<boolean> =>
  (await tx<{ claimed: boolean }[]>`select partner_host_claimed(${host}) as claimed`)[0]?.claimed ?? false

export const selectPartnerDomainForUpdate = async (tx: ScopedSql, id: string): Promise<PartnerDomainRow | null> =>
  (await tx<PartnerDomainRow[]>`select * from partner_domain where id = ${id} for update`)[0] ?? null

export const updateRecordChecks = async (tx: ScopedSql, checks: readonly { id: string; found: string | null }[], checkedAt: Date): Promise<void> => {
  for (const c of checks) await tx`update partner_domain_record set found = ${c.found}, checked_at = ${checkedAt} where id = ${c.id}`
}

/** Waiting or failed addresses not checked since `before`, for the scheduled re-check (SAAS §8): a failed record may be fixed. */
export const selectDuePartnerDomains = (tx: ScopedSql, before: Date, limit: number): Promise<{ id: string; partner_id: string }[]> =>
  tx<{ id: string; partner_id: string }[]>`
    select id, partner_id from partner_domain
    where status in ('waiting', 'failed') and (checked_at is null or checked_at < ${before})
    order by checked_at nulls first, id
    limit ${limit}
  `

export interface MerchantDomainRow {
  id: string
  store_id: string
  store_name: string
  host: string
  status: HostStatus
  created_at: Date
  checked_at: Date | null
}

// custom_domain keeps microseconds; the cursor carries milliseconds, so both sides are cut to them.
export const selectMerchantDomains = async (tx: ScopedSql, partnerId: string, page: KeysetPage, limit: number): Promise<MerchantDomainRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<MerchantDomainRow[]>`
    select d.id, d.store_id, s.name as store_name, d.host, d.status, date_trunc('milliseconds', d.created_at) as created_at, d.checked_at
    from custom_domain d join store s on s.id = d.store_id
    where s.partner_id = ${partnerId}
      ${page.after !== undefined ? tx`and (date_trunc('milliseconds', d.created_at), d.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (date_trunc('milliseconds', d.created_at), d.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by date_trunc('milliseconds', d.created_at) asc, d.id asc` : tx`order by date_trunc('milliseconds', d.created_at) desc, d.id desc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

/** The address and its records; the caller has already read it through the partner's scope. */
export const deletePartnerAddress = async (tx: ScopedSql, domainId: string): Promise<void> => {
  await tx`delete from partner_domain_record where domain_id = ${domainId}`
  await tx`delete from partner_domain where id = ${domainId}`
}
