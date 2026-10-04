import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DomainsPage } from '../../api/domains'
import { messages } from '../../messages'
import { AddressStep, CheckStep, RecordsStep } from './AddDomain'
import { exampleFor, firstKind, hostFrom, refusalText } from './addDomainRules'
import { Domains } from './Domains'
import { addresses, domainsPages, testNow } from './domainsTestData'

const words = messages.domains
const noop = () => undefined
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))

const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/domains'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const domains = (page: DomainsPage, forced: Parameters<typeof Domains>[0]['forced'] = null) =>
  render(<Domains page={page} forced={forced} now={testNow} checking={null} merchants={{ items: page.merchants.items, more: false, busy: false }} onRecheck={noop} onMore={noop} onCopy={noop} onRetry={noop} />)

describe('the four addresses', () => {
  it('draw a card each with its status, when it was checked, Re-check now and the record table', async () => {
    const text = textOf(await domains(domainsPages.mixed))
    for (const kind of ['portal', 'preview', 'shops', 'email'] as const) expect(text).toContain(words.kinds[kind].label)
    for (const status of ['live', 'waiting', 'failed', 'verifying'] as const) expect(text).toContain(words.status[status])
    expect(text).toContain('Checked 12 min ago')
    expect(text).toContain('Waiting since Sep 28, 2026')
    expect(text.match(new RegExp(words.recheck, 'g'))).toHaveLength(4)
    for (const column of [words.records.type, words.records.name, words.records.value, words.records.found]) expect(text).toContain(column)
    expect(text).toContain(words.purposes.dkim)
    expect(text).toContain(words.purposes.pointer.portal)
    expect(text).toContain(words.records.nothing)
    expect(text).toContain(words.records.mismatch)
    expect(text).toContain('Until it’s live, emails come from no-reply@northstar.dripfunnel-mail.com with your product name.')
  })

  it('drop the fallback sender once email is live, and Add once all four are added', async () => {
    const html = await domains(domainsPages.allLive)
    expect(textOf(html)).not.toContain('Until it’s live')
    expect(hrefs(html)).not.toContain('/domains/new')
  })

  it('show the DNS failing scenario as stopped working, with what DNS returns instead', async () => {
    const text = textOf(await domains(domainsPages.failing))
    expect(text.match(new RegExp(words.status.broken, 'g'))).toHaveLength(2)
    expect(text).toContain('192.0.2.10')
  })
})

describe('Add an address on Domains', () => {
  it('is a link for Owners and Admins, and refused with the reason for anyone else', async () => {
    expect(hrefs(await domains(domainsPages.mixed))).not.toContain('/domains/new')
    const owner = { ...domainsPages.support, partner: { ...domainsPages.support.partner, canAdd: true } }
    expect(hrefs(await domains(owner))).toContain('/domains/new')
    const support = textOf(await domains(domainsPages.support))
    expect(support).toContain(words.addRefused)
    expect(textOf(await domains(owner, 'denied'))).toContain(words.addRefused)
  })

  it('starts a new partner with the portal address', async () => {
    const html = await domains(domainsPages.none)
    expect(textOf(html)).toContain(words.empty.title)
    expect(hrefs(html)).toContain('/domains/new?k=portal')
    expect(textOf(await domains(domainsPages.mixed, 'empty'))).toContain(words.empty.title)
  })
})

describe('merchants’ own domains', () => {
  it('list each with its store, status and since, linking to the store’s Domains tab', async () => {
    const html = await domains(domainsPages.mixed)
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/stores/s1?tab=domains', '/stores/s2?tab=domains']))
    expect(textOf(html)).toContain('Since Sep 28, 2026')
    expect(textOf(await domains({ ...domainsPages.mixed, merchants: { ...domainsPages.mixed.merchants, items: [] } }))).toContain(words.merchants.none)
  })
})

describe('the states', () => {
  it('load and fail with their own words', async () => {
    expect(await domains(domainsPages.mixed, 'loading')).toContain('df-skeleton')
    expect(textOf(await domains(domainsPages.mixed, 'error'))).toContain(words.error.title)
  })
})

describe('the three steps', () => {
  const step1 = (kind: 'portal' | 'preview', error: string | null = null) =>
    render(<AddressStep addresses={domainsPages.support.partner.addresses} zone="northstar.com" kind={kind} typed="" error={error} busy={false} onKind={noop} onType={noop} onContinue={noop} />)

  it('asks what the address is for, marks the added ones, and puts *. before a wildcard', async () => {
    const html = await step1('preview')
    expect(textOf(html)).toContain(words.new.kindQuestion)
    expect(html.match(/<input type="radio"[^>]*disabled=""/g)).toHaveLength(2)
    expect(textOf(html)).toContain(words.new.added)
    expect(html).toContain('*.</span>')
    expect(textOf(html)).toContain(words.new.wildcardField)
    expect(textOf(await step1('portal', 'Bad'))).toContain('Bad')
  })

  it('shows the records to add, and warns about a root domain', async () => {
    const records = textOf(await render(<RecordsStep address={addresses.email} apex={false} busy={false} onCopy={noop} onCheck={noop} />))
    expect(records).toContain('Add these 3 records at your DNS provider')
    expect(records).toContain('Sign in where you manage DNS for northstar.com')
    const uk = textOf(await render(<RecordsStep address={{ ...addresses.email, host: 'mail.northstar.co.uk', zone: 'northstar.co.uk' }} apex={false} busy={false} onCopy={noop} onCheck={noop} />))
    expect(uk).toContain('Sign in where you manage DNS for northstar.co.uk')
    expect(records).toContain('I’ve added them. Check now')
    const apex = textOf(await render(<RecordsStep address={{ ...addresses.portal, host: 'northstar.com' }} apex busy={false} onCopy={noop} onCheck={noop} />))
    expect(apex).toContain('If northstar.com is also your website, the website will stop working.')
  })

  it('says the records were found while the certificate is issued, and when they don’t match', async () => {
    const issuing = textOf(await render(<CheckStep address={{ ...addresses.portal, status: 'issuing' }} more={false} note={null} busy={false} onCheck={noop} onNext={noop} />))
    expect(issuing).toContain(words.new.found.other)
    expect(issuing).toContain(words.status.issuing)
    expect(textOf(await render(<CheckStep address={addresses.shops} more={false} note={null} busy={false} onCheck={noop} onNext={noop} />))).toContain(words.new.mismatch.one)
  })

  it('ends saved and waiting, or live with the next address to add', async () => {
    const waiting = textOf(await render(<CheckStep address={addresses.preview} more note={null} busy={false} onCheck={noop} onNext={noop} />))
    expect(waiting).toContain(words.new.waiting.one)
    expect(waiting).toContain(words.new.checkAgain)
    const live = await render(<CheckStep address={addresses.portal} more note={null} busy={false} onCheck={noop} onNext={noop} />)
    expect(textOf(live)).toContain(words.new.live.portal.other)
    expect(textOf(live)).not.toContain(words.new.checkAgain)
    expect(live).toMatch(/<button[^>]*>Add the next address<\/button>/)
  })
})

describe('the address rules', () => {
  it('take a hostname from what was typed, and name examples under the partner’s domain', () => {
    expect(hostFrom('  https://Store.Northstar.com/sign-in ')).toBe('store.northstar.com')
    expect(hostFrom('*.preview.northstar.com')).toBe('preview.northstar.com')
    expect(exampleFor('email', 'northstar.co.uk')).toBe('mail.northstar.co.uk')
    expect(exampleFor('portal', null)).toBe('store.yourcompany.com')
  })

  it('word every refusal by its code', () => {
    for (const code of Object.keys(words.new.refused) as (keyof typeof words.new.refused)[]) expect(refusalText(code, 'mail.northstar.com')).not.toContain('{')
    expect(refusalText('BARE_DOMAIN_FOR_WILDCARD', 'mail.northstar.com')).toContain('mail.northstar.com')
  })

  it('start on the kind a link asks for while it is free, else the first not added', () => {
    const { addresses: list } = domainsPages.support.partner
    expect(firstKind(list, 'email')).toBe('email')
    expect(firstKind(list, 'portal')).toBe('shops')
    expect(firstKind(list, undefined)).toBe('shops')
  })
})
