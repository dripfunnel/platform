import type { Address, DomainsPage, MerchantDomain } from '../../api/domains'

// What the Platform API answers for a partner's Domains page, in each case the tests draw.
const since = '2026-09-28T09:00:00.000Z'
const checked = '2026-10-04T11:48:00.000Z'
export const testNow = Date.parse('2026-10-04T12:00:00.000Z')

const portal: Extract<Address, { added: true }> = {
  kind: 'portal',
  added: true,
  host: 'store.northstar.com',
  zone: 'northstar.com',
  status: 'live',
  since,
  checkedAt: checked,
  records: [
    { purpose: 'pointer', type: 'CNAME', name: 'store', value: 'portal.edge.dripfunnel.net', found: 'portal.edge.dripfunnel.net', matches: true },
    { purpose: 'ownership', type: 'TXT', name: '_dripfunnel.store', value: 'df-verify=a1b2c3', found: 'df-verify=a1b2c3', matches: true },
  ],
}
const preview: Extract<Address, { added: true }> = {
  kind: 'preview',
  added: true,
  host: '*.preview.northstar.com',
  zone: 'northstar.com',
  status: 'waiting',
  since,
  checkedAt: null,
  records: [{ purpose: 'pointer', type: 'CNAME', name: '*.preview', value: 'preview.edge.dripfunnel.net', found: null, matches: false }],
}
const shops: Extract<Address, { added: true }> = {
  kind: 'shops',
  added: true,
  host: '*.shops.northstar.com',
  zone: 'northstar.com',
  status: 'failed',
  since,
  checkedAt: checked,
  records: [{ purpose: 'pointer', type: 'CNAME', name: '*.shops', value: 'shops.edge.dripfunnel.net', found: 'old-host.example.net', matches: false }],
}
const email: Extract<Address, { added: true }> = {
  kind: 'email',
  added: true,
  host: 'mail.northstar.com',
  zone: 'northstar.com',
  status: 'verifying',
  since,
  checkedAt: checked,
  records: [
    { purpose: 'spf', type: 'TXT', name: 'mail', value: 'v=spf1 include:spf.dripfunnel.net ~all', found: null, matches: false },
    { purpose: 'dkim', type: 'CNAME', name: 'df1._domainkey.mail', value: 'df1.dkim.dripfunnel.net', found: null, matches: false },
    { purpose: 'dmarc', type: 'TXT', name: '_dmarc.mail', value: 'v=DMARC1; p=quarantine', found: null, matches: false },
  ],
}

const merchants: MerchantDomain[] = [
  { storeId: 's1', storeName: 'Harbor Coffee', host: 'shop.harborcoffee.com', status: 'live', since },
  { storeId: 's2', storeName: 'Juniper & Co.', host: 'juniper.co', status: 'waiting', since },
]
const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }

const page = (addresses: Address[], extra: Partial<DomainsPage['partner']> = {}, merchantItems = merchants): DomainsPage => ({
  partner: { addresses, fallbackSender: 'no-reply@northstar.dripfunnel-mail.com', canAdd: addresses.some((a) => !a.added), ...extra },
  merchants: { items: merchantItems, pageInfo },
})

const none = (kind: Address['kind']): Address => ({ kind, added: false })
const live = (a: Extract<Address, { added: true }>): Address => ({ ...a, status: 'live', records: a.records.map((r) => ({ ...r, found: r.value, matches: true })) })

export const domainsPages = {
  none: page([none('portal'), none('preview'), none('shops'), none('email')], {}, []),
  // One of each status §9.1 draws, the email sender not live yet.
  mixed: page([portal, preview, shops, email]),
  allLive: page([portal, live(preview), live(shops), live(email)], { fallbackSender: null, canAdd: false }),
  // The DNS failing scenario: the portal and the email sender stopped pointing at DripFunnel.
  failing: page([{ ...portal, status: 'broken', records: portal.records.map((r) => ({ ...r, found: '192.0.2.10', matches: false })) }, live(preview), live(shops), { ...email, status: 'broken' }], { canAdd: false }),
  // Support: two added, Add refused by the role.
  support: page([portal, preview, none('shops'), none('email')], { canAdd: false }),
}

export const addresses = { portal, preview, shops, email }
