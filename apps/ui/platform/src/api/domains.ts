import { ApiError, type PageInfo } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Domains on the Platform API (FIRST-RELEASE.md §9, §16): the partner's four addresses with their
// DNS records, adding one, re-checking one, and the merchants' own domains.
export const domainKinds = ['portal', 'preview', 'shops', 'email'] as const
export type DomainKind = (typeof domainKinds)[number]

export const hostStatuses = ['waiting', 'verifying', 'issuing', 'live', 'failed', 'expiring', 'broken'] as const
export type HostStatus = (typeof hostStatuses)[number]

export const recordPurposes = ['pointer', 'ownership', 'spf', 'dkim', 'dmarc'] as const
export type RecordPurpose = (typeof recordPurposes)[number]

export interface DnsRecord {
  purpose: RecordPurpose
  type: string
  name: string
  value: string
  // What DNS returned last, and whether it is what we asked for.
  found: string | null
  matches: boolean
}

export type Address =
  | { kind: DomainKind; added: false }
  // `zone`: where the address's DNS is managed, as the API reads it ("northstar.co.uk").
  | { kind: DomainKind; added: true; host: string; zone: string; status: HostStatus; since: string; checkedAt: string | null; records: readonly DnsRecord[] }

export interface PartnerDomains {
  addresses: readonly Address[]
  // SAAS §3.6: who emails come from until the email sender is live; null once it is.
  fallbackSender: string | null
  // Owners and Admins, while fewer than four addresses exist.
  canAdd: boolean
}

export interface MerchantDomain {
  storeId: string
  storeName: string
  host: string
  status: HostStatus
  since: string
}

export interface DomainsPage {
  partner: PartnerDomains
  merchants: { items: readonly MerchantDomain[]; pageInfo: PageInfo }
}

const recordSchema = z.object({ purpose: z.enum(recordPurposes), type: z.string(), name: z.string(), value: z.string(), found: z.string().nullable(), matches: z.boolean() })

const addressSchema = z
  .object({
    kind: z.enum(domainKinds),
    added: z.boolean(),
    host: z.string().nullable(),
    zone: z.string().nullable(),
    status: z.enum(hostStatuses).nullable(),
    since: z.string().nullable(),
    checkedAt: z.string().nullable(),
    records: z.array(recordSchema).nullable(),
  })
  .transform((a): Address =>
    a.added && a.host && a.zone && a.status && a.since
      ? { kind: a.kind, added: true, host: a.host, zone: a.zone, status: a.status, since: a.since, checkedAt: a.checkedAt, records: a.records ?? [] }
      : { kind: a.kind, added: false },
  )

const partnerSchema = z
  .object({ addresses: z.array(addressSchema), fallbackSender: z.string().nullable(), add: z.object({ allowed: z.boolean() }) })
  .transform((p): PartnerDomains => ({ addresses: p.addresses, fallbackSender: p.fallbackSender, canAdd: p.add.allowed }))

const partnerFields = `partnerDomains { addresses { kind added host zone status since checkedAt records { purpose type name value found matches } } fallbackSender add { allowed } }`

const pageInfoSchema = z.object({ startCursor: z.string().nullable(), endCursor: z.string().nullable(), hasPreviousPage: z.boolean(), hasNextPage: z.boolean() })

const merchantsSchema = z.object({
  items: z.array(z.object({ storeId: z.string(), storeName: z.string(), host: z.string(), status: z.enum(hostStatuses), since: z.string() })),
  pageInfo: pageInfoSchema,
})

export const loadPartnerDomains = async (): Promise<PartnerDomains> => (await query(`{ ${partnerFields} }`, z.object({ partnerDomains: partnerSchema }))).partnerDomains

// The merchants' list's first page; Show more follows the cursor, 25 at most each, no total (§16).
export const loadDomains = async (): Promise<DomainsPage> => {
  const answer = await query(
    `{
      ${partnerFields}
      merchantDomains { items { storeId storeName host status since } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } }
    }`,
    z.object({ partnerDomains: partnerSchema, merchantDomains: merchantsSchema }),
  )
  return { partner: answer.partnerDomains, merchants: answer.merchantDomains }
}

export const loadMerchantDomains = async (after: string): Promise<DomainsPage['merchants']> =>
  (
    await query(
      `query More($after: String) { merchantDomains(after: $after) { items { storeId storeName host status since } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } } }`,
      z.object({ merchantDomains: merchantsSchema }),
      { after },
    )
  ).merchantDomains

export const addRefusals = ['NOT_A_HOSTNAME', 'DRIPFUNNEL_DOMAIN', 'ALREADY_YOURS', 'HOST_TAKEN', 'BARE_DOMAIN_FOR_WILDCARD', 'KIND_TAKEN', 'APEX_NOT_AVAILABLE', 'INVALID_INPUT'] as const
export type AddRefusal = (typeof addRefusals)[number]

// `apex`: a root portal domain, which gets an A record and the website warning (§9.2).
export type AddResult = { ok: true; apex: boolean } | { ok: false; reason: AddRefusal }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), apex: z.boolean().nullable() })

const known = <T extends string>(codes: readonly T[], reason: string | null): T => {
  const code = codes.find((c) => c === reason)
  if (!code) throw new ApiError(reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return code
}

export const addPartnerDomain = async (kind: DomainKind, host: string): Promise<AddResult> => {
  const { addPartnerDomain: r } = await query(
    `mutation Add($kind: String!, $host: String!) { addPartnerDomain(kind: $kind, host: $host) { ok reason apex } }`,
    z.object({ addPartnerDomain: resultSchema }),
    { kind, host },
  )
  return r.ok ? { ok: true, apex: r.apex ?? false } : { ok: false, reason: known(addRefusals, r.reason) }
}

export const recheckRefusals = ['TOO_SOON', 'NOT_FOUND', 'INVALID_INPUT'] as const
export type RecheckResult = { ok: true } | { ok: false; reason: (typeof recheckRefusals)[number] }

// Queues a check; the address changes when it has run (a minute between presses, §16).
export const recheckPartnerDomain = async (kind: DomainKind): Promise<RecheckResult> => {
  const { recheckPartnerDomain: r } = await query(
    `mutation Recheck($kind: String!) { recheckPartnerDomain(kind: $kind) { ok reason } }`,
    z.object({ recheckPartnerDomain: z.object({ ok: z.boolean(), reason: z.string().nullable() }) }),
    { kind },
  )
  return r.ok ? { ok: true } : { ok: false, reason: known(recheckRefusals, r.reason) }
}
