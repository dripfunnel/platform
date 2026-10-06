import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { domainRecheckDeliverer } from '#jobs/queues/deliverers/domainRecheck'
import { domainRemoveDeliverer } from '#jobs/queues/deliverers/domainRemove'
import { CloudflareRefused, CloudflareUnavailable, type CloudflareApi } from '#integrations/cloudflare/api'
import { queueDueDomainChecks } from '#jobs/queues/domainSchedule'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import type { DnsLookup } from '#integrations/dns/doh'
import { localDns } from '#integrations/local/index'
import { activityLog } from '#saas/activity/index'
import { emailRecords } from '#saas/domains/index'
import { createPartnerDomainsService } from '#saas/partnerDomains/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #197: the partner's four addresses, adding and re-checking them, and merchants' domains.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', kl: '', bz: '', fresh: '', proxied: '', removal: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}, localHosts = false) => {
  const domains = createPartnerDomainsService({ sql: db.sql, caller, facts, activity: activityLog, edgeZone: 'dripfunnel.net', localHosts, now: () => now })
  const contextValue = { caller, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const overview = `{ partnerDomains { fallbackSender add { allowed }
  addresses { kind added host zone status since checkedAt records { purpose type name value found matches } } } }`
type Overview = {
  partnerDomains: {
    fallbackSender: string | null
    add: { allowed: boolean }
    addresses: { kind: string; added: boolean; host: string | null; zone: string | null; status: string | null; records: { purpose: string; type: string; name: string; value: string; matches: boolean }[] }[]
  }
}
const add = `mutation($kind: String!, $host: String!) { addPartnerDomain(kind: $kind, host: $host) { ok reason id apex } }`
type Added = { addPartnerDomain: { ok: boolean; reason: string | null; id: string | null; apex: boolean | null } }
const recheck = `mutation($kind: String!) { recheckPartnerDomain(kind: $kind) { ok reason } }`
const recheckStore = `mutation($id: ID!) { recheckMerchantDomain(storeId: $id) { ok reason } }`
const merchants = `query($after: String, $before: String, $first: Int) { merchantDomains(after: $after, before: $before, first: $first) {
  items { storeId storeName host status since } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }`
type Merchants = { merchantDomains: { items: { storeId: string; host: string }[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null } } }

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital'], ['bz', 'Bazaar Cloud']] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  }
  ids.fresh = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Fresh Partner', 'live') returning id`)[0]?.id ?? ''
  ids.proxied = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Proxied Partner', 'live') returning id`)[0]?.id ?? ''
  ids.removal = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Removal Partner', 'live') returning id`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the four addresses', () => {
  it('shows each address with its records, the email sender’s three, and the fallback sender while it waits', async () => {
    const ns = (await run<Overview>(overview, callerOf(ids.ns, 'partner-read-only'))).data?.partnerDomains
    expect(ns?.addresses.map((a) => [a.kind, a.added, a.status])).toEqual([
      ['portal', true, 'live'],
      ['preview', true, 'live'],
      ['shops', true, 'live'],
      ['email', true, 'live'],
    ])
    expect(ns?.addresses.find((a) => a.kind === 'shops')?.zone).toBe('northstar.example')
    expect(ns?.addresses.find((a) => a.kind === 'email')?.records.map((r) => [r.purpose, r.type, r.matches])).toEqual([
      ['spf', 'TXT', true],
      ['dkim', 'CNAME', true],
      ['dmarc', 'TXT', true],
    ])
    expect(ns?.fallbackSender).toBeNull()
    expect(ns?.add).toEqual({ allowed: false })
    // Until the sender is live, mail goes from DripFunnel's domain (SAAS §3.6).
    await db.sql`update partner_domain set status = 'waiting' where partner_id = ${ids.kl} and kind = 'email'`
    const kl = (await run<Overview>(overview, callerOf(ids.kl, 'partner-owner'))).data?.partnerDomains
    expect(kl?.addresses.find((a) => a.kind === 'email')?.status).toBe('waiting')
    expect(kl?.fallbackSender).toMatch(/^no-reply@[a-z0-9-]+\.dripfunnel-mail\.com$/)
    expect(JSON.stringify(kl)).not.toContain('northstar')
  })
})

describe('adding an address', () => {
  it('refuses each §9.2 case with its own code, and Support may not add at all', async () => {
    const owner = callerOf(ids.fresh, 'partner-owner')
    const refused = async (kind: string, host: string) => (await run<Added>(add, owner, { kind, host })).data?.addPartnerDomain.reason
    expect(await refused('portal', 'not a host!')).toBe('NOT_A_HOSTNAME')
    expect(await refused('portal', '10.0.0.1')).toBe('NOT_A_HOSTNAME')
    expect(await refused('portal', 'shop.dripfunnel.com')).toBe('DRIPFUNNEL_DOMAIN')
    expect(await refused('preview', 'freshpartner.example')).toBe('BARE_DOMAIN_FOR_WILDCARD')
    expect(await refused('email', 'freshpartner.co.uk')).toBe('BARE_DOMAIN_FOR_WILDCARD')
    expect(await refused('portal', 'freshpartner.example')).toBe('APEX_NOT_AVAILABLE')
    expect(await refused('portal', 'store.northstar.example')).toBe('HOST_TAKEN')
    expect(await refused('teleport', 'x.freshpartner.example')).toBe('INVALID_INPUT')
    expect((await run<Added>(add, callerOf(ids.fresh, 'partner-support'), { kind: 'portal', host: 'store.freshpartner.example' })).code).toBe('FORBIDDEN')
  })

  it('adds an address waiting with its records, queues the first check and logs it; the same host or kind again is refused', async () => {
    const owner = callerOf(ids.fresh, 'partner-owner')
    const added = (await run<Added>(add, owner, { kind: 'email', host: 'mail.freshpartner.example' })).data?.addPartnerDomain
    expect(added).toMatchObject({ ok: true, apex: false })
    expect(await db.sql`select status, host from partner_domain where id = ${added?.id ?? ''}`).toEqual([{ status: 'waiting', host: 'mail.freshpartner.example' }])
    expect(await db.sql`select purpose, name from partner_domain_record where domain_id = ${added?.id ?? ''} order by position`).toEqual([
      { purpose: 'spf', name: 'mail.freshpartner.example' },
      { purpose: 'dkim', name: 'df1._domainkey.mail.freshpartner.example' },
      { purpose: 'dmarc', name: '_dmarc.mail.freshpartner.example' },
      { purpose: 'ownership', name: '_dripfunnel.mail.freshpartner.example' },
    ])
    expect((await db.sql`select 1 from outbox where kind = 'domain.recheck' and payload->>'domainId' = ${added?.id ?? ''}`).length).toBe(1)
    expect((await db.sql`select 1 from activity_log where action = 'partner.domain_added' and partner_id = ${ids.fresh}`).length).toBe(1)
    const wildcard = (await run<Added>(add, owner, { kind: 'shops', host: 'shops.freshpartner.example' })).data?.addPartnerDomain
    expect(wildcard).toMatchObject({ ok: true })
    expect(await db.sql`select host from partner_domain where id = ${wildcard?.id ?? ''}`).toEqual([{ host: '*.shops.freshpartner.example' }])
    expect((await run<Added>(add, owner, { kind: 'portal', host: 'mail.freshpartner.example' })).data?.addPartnerDomain.reason).toBe('ALREADY_YOURS')
    expect((await run<Added>(add, owner, { kind: 'email', host: 'post.freshpartner.example' })).data?.addPartnerDomain.reason).toBe('KIND_TAKEN')
  })

  it('holds partner_domain_record to its partner at the database', async () => {
    const { withScope } = await import('#db/scoped/index')
    const asBazaar = <T>(work: Parameters<typeof withScope<T>>[2]) => withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: ids.bz }, work)
    const [nsDomain] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${ids.ns} and kind = 'portal'`
    const nsRecords = await db.sql`select 1 from partner_domain_record where partner_id = ${ids.ns}`
    expect(nsRecords.length).toBeGreaterThan(0)
    expect(await asBazaar((tx) => tx`select id from partner_domain_record where partner_id = ${ids.ns}`)).toEqual([])
    const insert = (partnerId: string) => (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => tx`
      insert into partner_domain_record (domain_id, partner_id, position, purpose, record_type, name, expected)
      values (${nsDomain?.id ?? ''}, ${partnerId}, 9, 'pointer', 'CNAME', 'x.example', 'y.example')`
    await expect(asBazaar(insert(ids.bz))).rejects.toThrow(/belongs to another partner/)
    await expect(asBazaar(insert(ids.ns))).rejects.toThrow(/row-level security/)
  })

  it('never lets a partner mark its own address live', async () => {
    const [mine] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${ids.fresh} limit 1`
    const { withScope } = await import('#db/scoped/index')
    await expect(
      withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: ids.fresh }, (tx) => tx`update partner_domain set status = 'live' where id = ${mine?.id ?? ''}`),
    ).rejects.toThrow(/permission denied/i)
    // Nor insert one already live, skipping the ownership proof.
    await expect(
      withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: ids.fresh }, (tx) => tx`
        insert into partner_domain (partner_id, kind, host, status, record_type, expected, found)
        values (${ids.fresh}, 'preview', '*.preview.unclaimed.example', 'live', 'CNAME', 'preview.edge.dripfunnel.net', 'preview.edge.dripfunnel.net')`),
    ).rejects.toThrow(/row-level security/i)
  })
})

describe('removing an address', () => {
  const remove = `mutation($kind: String!) { removePartnerDomain(kind: $kind) { ok reason } }`
  type Removed = { removePartnerDomain: { ok: boolean; reason: string | null } }

  it('removes the address and its records, queues the Cloudflare removal for a portal host and logs it', async () => {
    const owner = callerOf(ids.removal, 'partner-owner')
    const added = (await run<Added>(add, owner, { kind: 'portal', host: 'store.removable.example' })).data?.addPartnerDomain
    expect(added?.ok).toBe(true)
    expect((await run<Removed>(remove, owner, { kind: 'portal' })).data?.removePartnerDomain).toEqual({ ok: true, reason: null })
    expect(await db.sql`select 1 from partner_domain where id = ${added?.id ?? ''}`).toEqual([])
    expect(await db.sql`select 1 from partner_domain_record where domain_id = ${added?.id ?? ''}`).toEqual([])
    expect(await db.sql`select payload from outbox where kind = 'domain.remove' and payload->>'host' = 'store.removable.example'`).toHaveLength(1)
    expect(await db.sql`select 1 from activity_log where action = 'partner.domain_removed' and partner_id = ${ids.removal}`).toHaveLength(1)
  })

  it('finds nothing to remove for an address the partner never added, and takes no Cloudflare action for another kind', async () => {
    const owner = callerOf(ids.removal, 'partner-owner')
    expect((await run<Removed>(remove, owner, { kind: 'portal' })).data?.removePartnerDomain).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect((await run<Removed>(remove, owner, { kind: 'teleport' })).data?.removePartnerDomain.reason).toBe('INVALID_INPUT')
    await run<Added>(add, owner, { kind: 'email', host: 'mail.removable.example' })
    expect((await run<Removed>(remove, owner, { kind: 'email' })).data?.removePartnerDomain.ok).toBe(true)
    expect(await db.sql`select 1 from outbox where kind = 'domain.remove' and payload->>'host' = 'mail.removable.example'`).toEqual([])
  })

  it('never removes another partner’s address, and a role without domains.write may not remove at all', async () => {
    const before = await db.sql`select count(*)::int as n from partner_domain where partner_id = ${ids.ns}`
    const intruder = callerOf(ids.removal, 'partner-owner')
    expect((await run<Removed>(remove, intruder, { kind: 'portal' })).data?.removePartnerDomain).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await db.sql`select count(*)::int as n from partner_domain where partner_id = ${ids.ns}`).toEqual(before)
    expect((await run<Removed>(remove, callerOf(ids.ns, 'partner-support'), { kind: 'portal' })).code).toBe('FORBIDDEN')
    expect(await db.sql`select count(*)::int as n from partner_domain where partner_id = ${ids.ns}`).toEqual(before)
  })
})

describe('checking', () => {
  it('lets every role re-check its own address, queues it once a minute, and finds nothing of another partner’s', async () => {
    expect((await run<Record<string, unknown>>(recheck, callerOf(ids.ns, 'partner-support'), { kind: 'portal' })).data?.['recheckPartnerDomain']).toEqual({ ok: true, reason: null })
    expect((await run<Record<string, unknown>>(recheck, callerOf(ids.ns, 'partner-read-only'), { kind: 'portal' })).data?.['recheckPartnerDomain']).toEqual({ ok: true, reason: null })
    expect((await db.sql`select 1 from outbox o join partner_domain d on d.id::text = o.payload->>'domainId' where d.partner_id = ${ids.ns} and d.kind = 'portal'`).length).toBe(1)
    // The second press in the same minute folds into the first, and is not logged again.
    expect((await db.sql`select 1 from activity_log where partner_id = ${ids.ns} and action = 'partner.domain_recheck_requested'`).length).toBe(1)
    await db.sql`update partner_domain set checked_at = ${new Date(now.getTime() - 20_000)} where partner_id = ${ids.ns} and kind = 'preview'`
    expect((await run<Record<string, unknown>>(recheck, callerOf(ids.ns, 'partner-owner'), { kind: 'preview' })).data?.['recheckPartnerDomain']).toEqual({ ok: false, reason: 'TOO_SOON' })
    expect((await run<Record<string, unknown>>(recheck, callerOf(ids.fresh, 'partner-owner'), { kind: 'portal' })).data?.['recheckPartnerDomain']).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('makes an address live once every record matches, emails the partner, and waits while one is missing', async () => {
    const [email] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${ids.fresh} and kind = 'email'`
    const [token] = await db.sql<{ expected: string }[]>`select expected from partner_domain_record where domain_id = ${email?.id ?? ''} and purpose = 'ownership'`
    // The partner's own SPF and a stricter DMARC still count: ours is included, not equal.
    const answer = (dmarc: string[]) => async (host: string, type: string) =>
      host.startsWith('_dripfunnel.') ? [token?.expected ?? ''] : host.startsWith('_dmarc.') ? dmarc : type === 'TXT' ? ['v=spf1 include:_spf.google.com include:spf.dripfunnel.net -all'] : [emailRecords.dkim]
    const partial: DnsLookup = { resolve: answer([]) }
    const full: DnsLookup = { resolve: answer(['v=DMARC1; p=reject; rua=mailto:dmarc@freshpartner.example']) }
    const deliver = (lookup: DnsLookup, at: number) => relayDue(db.sql, { 'domain.recheck': domainRecheckDeliverer(db.sql, lookup, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + at) })
    await deliver(partial, 1000)
    expect(await db.sql`select status from partner_domain where id = ${email?.id ?? ''}`).toEqual([{ status: 'waiting' }])
    await db.sql`insert into outbox (id, kind, idempotency_key, payload, partner_id) values (${crypto.randomUUID()}, 'domain.recheck', ${`test:${email?.id ?? ''}`}, ${JSON.stringify({ partnerId: ids.fresh, domainId: email?.id })}::text::jsonb, ${ids.fresh})`
    await deliver(full, 2000)
    expect(await db.sql`select status from partner_domain where id = ${email?.id ?? ''}`).toEqual([{ status: 'live' }])
    expect((await db.sql<{ found: string }[]>`select found from partner_domain_record where domain_id = ${email?.id ?? ''} order by position`).map((r) => r.found)).toEqual([
      'v=spf1 include:_spf.google.com include:spf.dripfunnel.net -all',
      emailRecords.dkim,
      'v=DMARC1; p=reject; rua=mailto:dmarc@freshpartner.example',
      token?.expected,
    ])
    expect((await db.sql`select 1 from outbox where payload->>'template' = 'partner-domain-live' and payload->>'domainId' = ${email?.id ?? ''}`).length).toBe(1)
  })

  it('takes *.localhost addresses only on a local Worker, where the DNS stand-in makes them live through the real check', async () => {
    const [local] = await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Acme Local', 'draft') returning id`
    const owner = callerOf(local?.id ?? '', 'partner-owner')
    const hosts = { portal: 'store.acme.localhost', preview: 'preview.acme.localhost', shops: 'shops.acme.localhost', email: 'mail.acme.localhost' }
    expect((await run<Added>(add, owner, { kind: 'portal', host: hosts.portal })).data?.addPartnerDomain.reason).toBe('NOT_A_HOSTNAME')
    for (const [kind, host] of Object.entries(hosts)) expect((await run<Added>(add, owner, { kind, host }, true)).data?.addPartnerDomain, kind).toMatchObject({ ok: true })
    // Nothing on the internet is asked about a .localhost name: the stand-in answers what each record expects.
    const resolver = { resolve: async () => { throw new Error('asked the internet') } }
    await relayDue(db.sql, { 'domain.recheck': domainRecheckDeliverer(db.sql, localDns(db.sql, resolver), () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    expect(await db.sql`select kind, host, status from partner_domain where partner_id = ${local?.id ?? ''} order by kind`).toEqual([
      { kind: 'email', host: 'mail.acme.localhost', status: 'live' },
      { kind: 'portal', host: 'store.acme.localhost', status: 'live' },
      { kind: 'preview', host: '*.preview.acme.localhost', status: 'live' },
      { kind: 'shops', host: '*.shops.acme.localhost', status: 'live' },
    ])
  })

  it('lets a claim on a host wait without blocking its owner, and fails the claim that verifies second', async () => {
    const [other] = await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Squatter', 'live') returning id`
    const squatter = callerOf(other?.id ?? '', 'partner-owner')
    const owner = callerOf(ids.fresh, 'partner-owner')
    const claim = (await run<Added>(add, squatter, { kind: 'portal', host: 'store.freshpartner.example' })).data?.addPartnerDomain
    expect(claim).toMatchObject({ ok: true })
    const mine = (await run<Added>(add, owner, { kind: 'portal', host: 'store.freshpartner.example' })).data?.addPartnerDomain
    expect(mine).toMatchObject({ ok: true })
    const tokenOf = async (id: string) => (await db.sql<{ expected: string }[]>`select expected from partner_domain_record where domain_id = ${id} and purpose = 'ownership'`)[0]?.expected ?? ''
    const [ours, theirs] = [await tokenOf(mine?.id ?? ''), await tokenOf(claim?.id ?? '')]
    // DNS carries the owner's token, and for this test the squatter's too: the owner verifies first.
    const lookup = (tokens: string[]): DnsLookup => ({ resolve: async (host) => (host.startsWith('_dripfunnel.') ? tokens : ['portal.edge.dripfunnel.net']) })
    const check = (id: string, tokens: string[]) =>
      domainRecheckDeliverer(db.sql, lookup(tokens), () => now).deliver({ id: crypto.randomUUID(), kind: 'domain.recheck', idempotencyKey: `t:${id}`, payload: { partnerId: id === mine?.id ? ids.fresh : other?.id, domainId: id }, partnerId: null, storeId: null, attempt: 1 }, new AbortController().signal)
    await check(mine?.id ?? '', [ours])
    await check(claim?.id ?? '', [ours, theirs])
    expect(await db.sql`select partner_id, status from partner_domain where lower(host) = 'store.freshpartner.example' order by status`).toEqual([
      { partner_id: other?.id, status: 'failed' },
      { partner_id: ids.fresh, status: 'live' },
    ])
    expect((await run<Added>(add, squatter, { kind: 'preview', host: 'preview.freshpartner.example' })).data?.addPartnerDomain).toMatchObject({ ok: true })
  })

  it('queues the scheduled check for waiting and failed addresses once per ten minutes', async () => {
    const [shops] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${ids.fresh} and kind = 'shops'`
    await db.sql`update partner_domain set status = 'failed', checked_at = ${new Date(Date.now() - 3_600_000)} where id = ${shops?.id ?? ''}`
    const queued = () => db.sql`select 1 from outbox where kind = 'domain.recheck' and payload->>'domainId' = ${shops?.id ?? ''} and idempotency_key like '%:scheduled:%'`
    const at = new Date()
    expect(await queueDueDomainChecks(db.sql, at)).toBeGreaterThan(0)
    await queueDueDomainChecks(db.sql, new Date(at.getTime() + 1000))
    expect((await queued()).length).toBe(1)
  })
})

describe('the portal host and Cloudflare for SaaS', () => {
  const owner = () => callerOf(ids.proxied, 'partner-owner')
  const lookupFor = (onResolve?: () => Promise<unknown>): DnsLookup => ({
    resolve: async (host, type) => {
      await onResolve?.()
      if (!host.startsWith('_dripfunnel.')) return type === 'CNAME' ? ['portal.edge.dripfunnel.net'] : []
      const [token] = await db.sql<{ expected: string }[]>`select expected from partner_domain_record where name = ${host} and purpose = 'ownership' and partner_id = ${ids.proxied}`
      return [token?.expected ?? '']
    },
  })
  const hostnameOf = (status: string, ssl: string) => ({ id: 'h1', hostname: 'x', status, ssl: { status: ssl } })
  const cloudflareWith = (ensure: () => Promise<ReturnType<typeof hostnameOf>>): CloudflareApi & { ensured: number } => {
    const api = { ensured: 0, ensureHostname: async () => (api.ensured++, ensure()), removeHostname: async () => undefined }
    return api
  }
  const recheck = (domainId: string, lookup: DnsLookup, cloudflare: CloudflareApi | null) =>
    domainRecheckDeliverer(db.sql, lookup, () => now, cloudflare).deliver({ payload: { partnerId: ids.proxied, domainId } } as never, new AbortController().signal)
  const statusOf = async (id: string) => (await db.sql<{ status: string }[]>`select status from partner_domain where id = ${id}`)[0]?.status
  const addPortal = async (host: string) => (await run<Added>(add, owner(), { kind: 'portal', host })).data?.addPartnerDomain.id ?? ''

  it('takes the portal host’s state from Cloudflare once DNS passes, and registers nothing before', async () => {
    const id = await addPortal('store.proxied.example')
    const waiting = cloudflareWith(async () => hostnameOf('pending', 'initializing'))
    await recheck(id, { resolve: async () => [] }, waiting)
    expect(waiting.ensured).toBe(0)
    await recheck(id, lookupFor(), waiting)
    expect(await statusOf(id)).toBe('verifying')
    await recheck(id, lookupFor(), cloudflareWith(async () => hostnameOf('active', 'pending_issuance')))
    expect(await statusOf(id)).toBe('issuing')
    await recheck(id, lookupFor(), cloudflareWith(async () => hostnameOf('active', 'active')))
    expect(await statusOf(id)).toBe('live')
  })

  it('fails the address when Cloudflare refuses the host, and rethrows for a retry when Cloudflare is down', async () => {
    const id = (await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${ids.proxied} and kind = 'portal'`)[0]?.id ?? ''
    await db.sql`update partner_domain set status = 'waiting' where id = ${id}`
    await recheck(id, lookupFor(), cloudflareWith(async () => Promise.reject(new CloudflareRefused('answered 403'))))
    expect(await statusOf(id)).toBe('failed')
    await db.sql`update partner_domain set status = 'waiting' where id = ${id}`
    await expect(recheck(id, lookupFor(), cloudflareWith(async () => Promise.reject(new CloudflareUnavailable('no answer'))))).rejects.toBeInstanceOf(CloudflareUnavailable)
    expect(await statusOf(id)).toBe('waiting')
  })

  it('does not register a host a partner removed while its check was running', async () => {
    const id = (await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${ids.proxied} and kind = 'portal'`)[0]?.id ?? ''
    const ghost = cloudflareWith(async () => hostnameOf('pending', 'initializing'))
    await recheck(id, lookupFor(() => run(`mutation { removePartnerDomain(kind: "portal") { ok } }`, owner(), {})), ghost)
    expect(ghost.ensured).toBe(0)
  })

  it('removes a removed host from Cloudflare and leaves one a partner has claimed since', async () => {
    const removed: string[] = []
    const cloudflare: CloudflareApi = { ensureHostname: async () => hostnameOf('active', 'active'), removeHostname: async (host) => void removed.push(host) }
    const effect = (host: string) => domainRemoveDeliverer(db.sql, cloudflare).deliver({ payload: { host } } as never, new AbortController().signal)
    await effect('store.gone.example')
    expect(removed).toEqual(['store.gone.example'])
    await addPortal('store.claimed.example')
    await effect('store.claimed.example')
    expect(removed).toEqual(['store.gone.example'])
  })
})

describe('merchants’ domains', () => {
  it('pages the partner’s stores’ domains both ways and never another partner’s, nor re-checks them', async () => {
    // Enough rows on both partners that paging and disjointness are really exercised.
    for (const [partnerId, prefix, n] of [[ids.ns, 'nsshop', 4], [ids.bz, 'bzshop', 2]] as const) {
      const stores = await db.sql<{ id: string }[]>`select id from store where partner_id = ${partnerId} and id not in (select store_id from custom_domain) order by name limit ${n}`
      for (const [i, s] of stores.entries()) {
        await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${s.id}, ${`${prefix}${i}.example`}, 'waiting', 'shops.edge.dripfunnel.net', ${`df-verify=${prefix}${i}`})`
      }
    }
    const owner = callerOf(ids.ns, 'partner-owner')
    const all = await db.sql<{ id: string }[]>`select d.id from custom_domain d join store s on s.id = d.store_id where s.partner_id = ${ids.ns}`
    expect(all.length).toBeGreaterThan(2)
    const first = (await run<Merchants>(merchants, owner, { first: 2 })).data?.merchantDomains
    expect(first?.items).toHaveLength(2)
    expect(first?.pageInfo.hasNextPage).toBe(true)
    const seen = [...(first?.items ?? [])]
    let page = first
    while (page?.pageInfo.hasNextPage) {
      page = (await run<Merchants>(merchants, owner, { after: page.pageInfo.endCursor, first: 2 })).data?.merchantDomains
      seen.push(...(page?.items ?? []))
    }
    expect(seen).toHaveLength(all.length)
    expect(page?.pageInfo.hasPreviousPage).toBe(true)
    const back = (await run<Merchants>(merchants, owner, { before: page?.pageInfo.startCursor, first: 2 })).data?.merchantDomains.items ?? []
    expect(back.length).toBeGreaterThan(0)
    expect(back.every((d) => seen.some((m) => m.storeId === d.storeId))).toBe(true)
    const theirs = (await run<Merchants>(merchants, callerOf(ids.bz, 'partner-owner'), { first: 25 })).data?.merchantDomains.items ?? []
    expect(theirs.length).toBeGreaterThan(0)
    expect(theirs.some((d) => seen.some((m) => m.storeId === d.storeId))).toBe(false)
    const [nsStore] = await db.sql<{ store_id: string }[]>`
      update custom_domain set checked_at = null where id = (select d.id from custom_domain d join store s on s.id = d.store_id where s.partner_id = ${ids.ns} limit 1) returning store_id`
    expect((await run<Record<string, unknown>>(recheckStore, callerOf(ids.bz, 'partner-owner'), { id: nsStore?.store_id })).data?.['recheckMerchantDomain']).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect((await run<Record<string, unknown>>(recheckStore, callerOf(ids.ns, 'partner-support'), { id: nsStore?.store_id })).data?.['recheckMerchantDomain']).toEqual({ ok: true, reason: null })
    expect((await run(merchants, owner, { after: 'nope' })).code).toBe('INVALID_INPUT')
  })

})
