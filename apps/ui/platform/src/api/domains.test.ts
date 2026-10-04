import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPartnerDomain, loadDomains, loadMerchantDomains, recheckPartnerDomain } from './domains'

// The rules are the Platform API's (apps/api tests/platform-domains); these check the client reads its answers.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

const pageInfo = { startCursor: null, endCursor: 'c1', hasPreviousPage: false, hasNextPage: true }
const record = { purpose: 'dkim', type: 'CNAME', name: 'df1._domainkey.mail', value: 'df1.dkim.dripfunnel.net', found: null, matches: false }

describe('loadDomains', () => {
  it('reads an added address with its records, one not added, the fallback sender and Add', async () => {
    answer.mockReturnValue({
      data: {
        partnerDomains: {
          addresses: [
            { kind: 'email', added: true, host: 'mail.northstar.com', zone: 'northstar.com', status: 'waiting', since: '2026-09-28T09:00:00.000Z', checkedAt: null, records: [record] },
            { kind: 'portal', added: false, host: null, zone: null, status: null, since: null, checkedAt: null, records: null },
          ],
          fallbackSender: 'no-reply@northstar.dripfunnel-mail.com',
          add: { allowed: true },
        },
        merchantDomains: { items: [{ storeId: 's1', storeName: 'Harbor', host: 'shop.harbor.com', status: 'live', since: '2026-09-01T00:00:00.000Z' }], pageInfo },
      },
    })
    const page = await loadDomains()
    expect(page.partner.addresses).toEqual([
      { kind: 'email', added: true, host: 'mail.northstar.com', zone: 'northstar.com', status: 'waiting', since: '2026-09-28T09:00:00.000Z', checkedAt: null, records: [record] },
      { kind: 'portal', added: false },
    ])
    expect(page.partner).toMatchObject({ fallbackSender: 'no-reply@northstar.dripfunnel-mail.com', canAdd: true })
    expect(page.merchants.pageInfo.hasNextPage).toBe(true)
  })

  it('pages the merchants’ list by its cursor', async () => {
    answer.mockReturnValue({ data: { merchantDomains: { items: [], pageInfo } } })
    await loadMerchantDomains('c1')
    expect(answer.mock.calls[0]?.[0].variables).toEqual({ after: 'c1' })
  })
})

describe('adding and re-checking', () => {
  it('reads a root portal domain, every refusal by code, and errors on a code it doesn’t know', async () => {
    answer.mockReturnValueOnce({ data: { addPartnerDomain: { ok: true, reason: null, apex: true } } })
    expect(await addPartnerDomain('portal', 'northstar.com')).toEqual({ ok: true, apex: true })
    expect(answer.mock.calls[0]?.[0].variables).toEqual({ kind: 'portal', host: 'northstar.com' })
    answer.mockReturnValueOnce({ data: { addPartnerDomain: { ok: false, reason: 'HOST_TAKEN', apex: null } } })
    expect(await addPartnerDomain('shops', 'shops.x.com')).toEqual({ ok: false, reason: 'HOST_TAKEN' })
    answer.mockReturnValueOnce({ data: { addPartnerDomain: { ok: false, reason: 'SOMETHING_NEW', apex: null } } })
    await expect(addPartnerDomain('shops', 'shops.x.com')).rejects.toMatchObject({ code: 'SOMETHING_NEW' })
  })

  it('reads a queued re-check, and one that came too soon', async () => {
    // Exactly what the query asks for: a re-check has no apex.
    answer.mockReturnValueOnce({ data: { recheckPartnerDomain: { ok: true, reason: null } } })
    expect(await recheckPartnerDomain('email')).toEqual({ ok: true })
    answer.mockReturnValueOnce({ data: { recheckPartnerDomain: { ok: false, reason: 'TOO_SOON' } } })
    expect(await recheckPartnerDomain('email')).toEqual({ ok: false, reason: 'TOO_SOON' })
  })
})
