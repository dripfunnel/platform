import type { DomainKind } from '#db/schema/saas'

// The records each partner address needs (SAAS §3.5–3.6); the apex address waits on SAAS §8.

export type RecordPurpose = 'pointer' | 'ownership' | 'spf' | 'dkim' | 'dmarc'

export interface PlannedRecord {
  purpose: RecordPurpose
  recordType: 'CNAME' | 'TXT' | 'A'
  name: string
  expected: string
}

// Registrable two-level suffixes, so "northstar.co.uk" reads as bare like "northstar.com".
const twoLevelSuffixes = ['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'co.in', 'co.jp', 'com.br', 'com.mx', 'co.za', 'com.sg', 'com.my', 'com.ng', 'com.tr', 'co.kr']

export const registrableLabels = (host: string): number => (twoLevelSuffixes.includes(host.split('.').slice(-2).join('.')) ? 3 : 2)

const senderKindOrder = ['portal', 'shops', 'preview', 'email']

/**
 * The label of the partner's fallback sender, `no-reply@<label>.<sender domain>` (SAAS §3.6):
 * "northstar" for the host "store.northstar.co.uk", its portal host first. Null with no host.
 */
export const senderLabel = (domains: readonly { kind: string; host: string }[]): string | null => {
  const first = [...domains].sort((a, b) => senderKindOrder.indexOf(a.kind) - senderKindOrder.indexOf(b.kind))[0]
  if (!first) return null
  const bare = first.host.replace(/^\*\./, '')
  return bare.split('.').at(-registrableLabels(bare)) ?? null
}

/** Where a host's DNS is managed: "store.northstar.co.uk" and "*.shops.northstar.co.uk" → "northstar.co.uk". */
export const zoneOf = (host: string): string => {
  const bare = host.replace(/^\*\./, '')
  return bare.split('.').slice(-registrableLabels(bare)).join('.')
}

/** A registrable domain itself, with no subdomain: "northstar.com", "northstar.co.uk". */
export const isBareDomain = (host: string): boolean => host.split('.').length <= registrableLabels(host)

/** A wildcard is checked through a probe name under it, since DNS answers for names, not patterns. */
export const nameToResolve = (host: string): string => (host.startsWith('*.') ? `df-probe.${host.slice(2)}` : host)

export const edgeTargets = {
  portal: 'portal.edge.dripfunnel.net',
  preview: 'preview.edge.dripfunnel.net',
  shops: 'shops.edge.dripfunnel.net',
} as const
export const apexAddress: string | null = null
export const emailRecords = {
  spf: 'v=spf1 include:spf.dripfunnel.net ~all',
  spfInclude: 'include:spf.dripfunnel.net',
  dkim: 'df1.dkim.dripfunnel.net',
  dmarc: 'v=DMARC1; p=quarantine',
} as const

/** The TXT record that proves this partner controls the host: a token per address (SAAS §8 step 2). */
export const ownershipRecord = (host: string, token: string): PlannedRecord => ({
  purpose: 'ownership',
  recordType: 'TXT',
  name: `_dripfunnel.${host.replace(/^\*\./, '')}`,
  expected: `dripfunnel-verify=${token}`,
})

/**
 * Whether what DNS returned is what the record needs. SPF and DMARC are one record per host that a
 * partner may already have, so ours is included in theirs rather than equal to it.
 */
export const recordMatches = (purpose: RecordPurpose, expected: string, found: string): boolean => {
  const value = found.trim().toLowerCase()
  if (purpose === 'spf') return value.startsWith('v=spf1') && value.split(/\s+/).includes(emailRecords.spfInclude)
  if (purpose === 'dmarc') return /^v=dmarc1\s*(;|$)/.test(value)
  return value === expected.toLowerCase()
}

/** Null for a root portal domain while there is no apex address to give. */
export const recordsFor = (kind: DomainKind, host: string, apex: boolean): PlannedRecord[] | null => {
  switch (kind) {
    case 'portal':
      if (!apex) return [{ purpose: 'pointer', recordType: 'CNAME', name: host, expected: edgeTargets.portal }]
      return apexAddress === null ? null : [{ purpose: 'pointer', recordType: 'A', name: host, expected: apexAddress }]
    case 'preview':
    case 'shops':
      return [{ purpose: 'pointer', recordType: 'CNAME', name: nameToResolve(host), expected: edgeTargets[kind] }]
    case 'email':
      return [
        { purpose: 'spf', recordType: 'TXT', name: host, expected: emailRecords.spf },
        { purpose: 'dkim', recordType: 'CNAME', name: `df1._domainkey.${host}`, expected: emailRecords.dkim },
        { purpose: 'dmarc', recordType: 'TXT', name: `_dmarc.${host}`, expected: emailRecords.dmarc },
      ]
  }
}
