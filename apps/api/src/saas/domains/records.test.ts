import { describe, expect, it } from 'vitest'
import type { DnsLookup } from '#integrations/dns/doh'
import { checkRecords } from './check'
import { emailRecords, isBareDomain, recordMatches } from './records'

describe('recordMatches', () => {
  it.each([
    ['spf', 'v=spf1 include:spf.dripfunnel.net ~all', true],
    ['spf', 'v=spf1 include:_spf.google.com include:spf.dripfunnel.net -all', true],
    ['spf', 'v=spf1 include:spf.dripfunnel.net.evil.com ~all', false],
    ['spf', 'include:spf.dripfunnel.net', false],
    ['dmarc', 'v=DMARC1; p=quarantine', true],
    ['dmarc', 'v=DMARC1; p=reject; rua=mailto:d@x.example', true],
    ['dmarc', 'v=DMARC1', true],
    ['dmarc', 'v=DMARC10; p=none', false],
    ['dkim', 'DF1.DKIM.DRIPFUNNEL.NET', true],
    ['dkim', 'df2.dkim.dripfunnel.net', false],
  ] as const)('%s %s → %s', (purpose, found, expected) => {
    const want = purpose === 'spf' ? emailRecords.spf : purpose === 'dmarc' ? emailRecords.dmarc : emailRecords.dkim
    expect(recordMatches(purpose, want, found)).toBe(expected)
  })
})

describe('isBareDomain', () => {
  it.each([
    ['northstar.com', true],
    ['northstar.co.uk', true],
    ['northstar.com.sg', true],
    ['mail.northstar.com', false],
    ['preview.northstar.co.uk', false],
  ])('%s → %s', (host, bare) => expect(isBareDomain(host)).toBe(bare))
})

describe('checkRecords', () => {
  const records = [
    { id: 'spf', purpose: 'spf' as const, record_type: 'TXT' as const, name: 'mail.x.example', expected: emailRecords.spf },
    { id: 'dkim', purpose: 'dkim' as const, record_type: 'CNAME' as const, name: 'df1._domainkey.mail.x.example', expected: emailRecords.dkim },
  ]
  const lookup = (answers: Record<string, string[]>): DnsLookup => ({ resolve: async (name) => answers[name] ?? [] })
  const signal = new AbortController().signal
  const both = { 'mail.x.example': [emailRecords.spf], 'df1._domainkey.mail.x.example': [emailRecords.dkim] }

  it('is live only when every record matches', async () => {
    expect((await checkRecords('waiting', records, lookup(both), signal)).status).toBe('live')
  })

  it('waits while one is missing, fails when one points elsewhere, and is broken once it was live', async () => {
    expect((await checkRecords('waiting', records, lookup({ 'mail.x.example': [emailRecords.spf] }), signal)).status).toBe('waiting')
    expect((await checkRecords('waiting', records, lookup({ ...both, 'df1._domainkey.mail.x.example': ['other.example'] }), signal)).status).toBe('failed')
    expect((await checkRecords('live', records, lookup({ 'mail.x.example': [emailRecords.spf] }), signal)).status).toBe('broken')
    expect((await checkRecords('broken', records, lookup(both), signal)).status).toBe('live')
  })

  it('never makes an address with no records live', async () => {
    let looked = 0
    const counting: DnsLookup = { resolve: async () => ((looked += 1), []) }
    expect((await checkRecords('waiting', [], counting, signal)).status).toBe('waiting')
    expect((await checkRecords('live', [], counting, signal)).status).toBe('broken')
    expect(looked).toBe(0)
  })
})
