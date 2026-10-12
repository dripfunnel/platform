import { ApiError } from '@dripfunnel/shared/graphql'
import { describe, expect, it } from 'vitest'
import type { StorefrontDomain, StorefrontStatus } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { brandComplete, brandFormOf, brandProblemOf, pickerValue } from './brandDraft'
import { canCancel, canMakePrimary, domainRefusal, inProgress, needsRecords } from './domainView'
import { counterText, googleTitle, seoTooLong } from './seoView'
import { chooseRefusal, hasSite, liveHost, needsTemplate, templateName } from './overviewView'
import { frameAddress, frameMessage, frameOriginOf, noteText, pageGroups, sampleAddress, textPageOf } from './studioRules'
import { storefrontAccessOf } from './storefrontAccess'

const words = messages.storefront

const domain = (over: Partial<StorefrontDomain>): StorefrontDomain => ({ id: 'd1', host: 'www.kesari.in', kind: 'custom', status: 'live', primary: false, checkedAt: null, records: [], ...over })

describe('storefront access', () => {
  it('gives the Owner the edits, the Manager a look, and Staff nothing', () => {
    expect(storefrontAccessOf(null, { permissions: ['storefront.read', 'publish'] }, false)).toEqual({ canRead: true, canEdit: true, notice: null })
    expect(storefrontAccessOf(null, { permissions: ['storefront.read'] }, false)).toEqual({ canRead: true, canEdit: false, notice: 'manager' })
    expect(storefrontAccessOf(null, { permissions: ['orders.read'] }, false)).toEqual({ canRead: false, canEdit: false, notice: null })
  })

  it('makes a past-due store view-only for the Owner too', () => {
    expect(storefrontAccessOf(null, { permissions: ['storefront.read', 'publish'] }, true)).toEqual({ canRead: true, canEdit: false, notice: 'readOnly' })
  })

  it('follows the harness when a state is forced', () => {
    expect(storefrontAccessOf('denied', { permissions: ['storefront.read', 'publish'] }, false).canRead).toBe(false)
    expect(storefrontAccessOf('manager', { permissions: [] }, false)).toEqual({ canRead: true, canEdit: false, notice: 'manager' })
    expect(storefrontAccessOf('list', { permissions: [] }, false).canEdit).toBe(true)
  })
})

describe('the brand', () => {
  it('is complete with a name and a logo, nothing else', () => {
    const empty = brandFormOf(null)
    expect(brandComplete(empty)).toBe(false)
    expect(brandComplete({ ...empty, shopName: 'Kesari' })).toBe(false)
    expect(brandComplete({ ...empty, shopName: '  ', logoAssetId: 'a' })).toBe(false)
    expect(brandComplete({ ...empty, shopName: 'Kesari', logoAssetId: 'a' })).toBe(true)
  })

  it('shows a picker only a full colour', () => {
    expect(pickerValue('#1D6B47')).toBe('#1d6b47')
    expect(pickerValue('abc')).toBe('#aabbcc')
    expect(pickerValue('orange')).toBe('#000000')
    expect(pickerValue(null)).toBe('#000000')
  })

  it('keeps a refusal with the field it names', () => {
    expect(brandProblemOf(new ApiError('INVALID_INPUT', 'x', { field: 'primaryColour' }), words.brand.refused)).toEqual({ field: 'primaryColour', text: words.brand.invalid.colour })
    expect(brandProblemOf(new ApiError('INVALID_IMAGE', 'x', { field: 'favicon' }), words.brand.refused)).toEqual({ field: 'favicon', text: words.brand.refused.INVALID_IMAGE })
    expect(brandProblemOf(new ApiError('INVALID_EMAIL', 'x'), words.brand.refused)).toEqual({ field: 'contactEmail', text: words.brand.refused.INVALID_EMAIL })
    expect(brandProblemOf(new ApiError('SUPPORT_READ_ONLY', 'x'), words.brand.refused)).toEqual({ field: null, text: words.brand.refused.SUPPORT_READ_ONLY })
    expect(brandProblemOf(new Error('offline'), words.brand.refused)).toEqual({ field: null, text: words.brand.refused.other })
  })
})

describe('domains', () => {
  it('read each built state as the portal shows it', () => {
    expect(needsRecords(domain({ status: 'waiting' }))).toBe(true)
    expect(needsRecords(domain({ status: 'failed' }))).toBe(true)
    expect(needsRecords(domain({ status: 'broken' }))).toBe(true)
    expect(needsRecords(domain({ status: 'issuing' }))).toBe(false)
    expect(needsRecords(domain({ kind: 'free', id: null, status: 'waiting' }))).toBe(false)
    expect(canMakePrimary(domain({ status: 'live' }))).toBe(true)
    expect(canMakePrimary(domain({ status: 'expiring' }))).toBe(true)
    expect(canMakePrimary(domain({ status: 'verifying' }))).toBe(false)
    expect(canMakePrimary(domain({ status: 'live', primary: true }))).toBe(false)
    expect(canCancel(domain({ status: 'waiting' }))).toBe(true)
    expect(canCancel(domain({ status: 'failed' }))).toBe(true)
    expect(canCancel(domain({ status: 'broken' }))).toBe(false)
    expect(inProgress([domain({ status: 'live' }), domain({ status: 'issuing' })])).toBe(true)
    expect(inProgress([domain({ status: 'failed' })])).toBe(false)
  })

  it('name the subdomain to use for a bare domain', () => {
    expect(domainRefusal(new ApiError('APEX_NOT_AVAILABLE', 'x', { suggested: 'www.kesari.in' }))).toBe(fill(words.domains.refused.APEX_NOT_AVAILABLE, { suggested: 'www.kesari.in' }))
    expect(domainRefusal(new ApiError('APEX_NOT_AVAILABLE', 'x'))).toBe(words.domains.refused.INVALID_HOSTNAME)
    expect(domainRefusal(new ApiError('PLAN_LIMIT', 'x'))).toBe(words.domains.refused.PLAN_LIMIT)
    expect(domainRefusal(new ApiError('SOMETHING_NEW', 'x'))).toBe(words.domains.refused.other)
  })
})

describe('search and sharing', () => {
  it('counts against the limit, in words once it is too long', () => {
    expect(counterText(60, 60)).toBe(fill(words.seo.count, { count: '60', limit: '60' }))
    expect(counterText(61, 60)).toBe(fill(words.seo.countOver, { count: '61', limit: '60' }))
    expect(seoTooLong({ title: 'x'.repeat(60), description: 'y'.repeat(155) })).toBe(false)
    expect(seoTooLong({ title: 'x', description: 'y'.repeat(156) })).toBe(true)
  })

  it('previews the shop’s name for an empty title and cuts a long one', () => {
    expect(googleTitle('  ', 'Kesari Threads')).toBe('Kesari Threads')
    expect(googleTitle('x'.repeat(70), 'Kesari')).toBe(`${'x'.repeat(58)}…`)
  })
})

describe('the overview and the gallery', () => {
  const free = { id: null, host: 'kesari.shops.example.com', kind: 'free' as const, status: 'live' as const, checkedAt: null, records: [] }

  it('reaches the live site at the main address once it is live, else at the free one', () => {
    expect(liveHost({ customDomainAllowed: true, domains: [{ ...free, primary: false }, domain({ primary: true })] })).toBe('www.kesari.in')
    expect(liveHost({ customDomainAllowed: true, domains: [{ ...free, primary: false }, domain({ primary: true, status: 'broken' })] })).toBe('kesari.shops.example.com')
    expect(liveHost({ customDomainAllowed: true, domains: [] })).toBeNull()
  })

  it('names "Start from scratch" as the prototype’s Custom, and an unknown key as itself', () => {
    const list = [{ key: 'linen', name: 'Linen', tag: '', description: '', demoUrl: null, current: true }]
    expect(templateName(list, 'linen')).toBe('Linen')
    expect(templateName(list, 'baseline')).toBe(words.overview.custom)
    expect(templateName(list, 'gone')).toBe('gone')
  })

  it('asks about the words only once the site exists, and shows the gallery until then', () => {
    const before: StorefrontStatus[] = ['not_started', 'creating', 'create_failed']
    const after: StorefrontStatus[] = ['not_published', 'same_as_live', 'unpublished_changes']
    expect(before.some(hasSite)).toBe(false)
    expect(after.every(hasSite)).toBe(true)
    expect(needsTemplate('create_failed')).toBe(true)
    expect(needsTemplate('creating')).toBe(false)
  })

  it('words a refused template, naming the place in the studio queue', () => {
    expect(chooseRefusal(new ApiError('STUDIO_QUEUED', 'x', { place: 3 }))).toBe(fill(words.gallery.refused.STUDIO_QUEUED, { place: '3' }))
    expect(chooseRefusal(new ApiError('STUDIO_QUEUED', 'x'))).toBe(words.gallery.refused.STUDIO_UNAVAILABLE)
    expect(chooseRefusal(new ApiError('BRAND_NOT_READY', 'x'))).toBe(words.gallery.refused.BRAND_NOT_READY)
    expect(chooseRefusal(new Error('offline'))).toBe(words.gallery.refused.other)
  })
})

describe('the studio’s rules', () => {
  const frame = 'https://k7.webpreview.store/__studio/abcdefghijklmnopqrstuv/'

  it('takes a frame only on https, under /__studio/, away from the portal’s origin', () => {
    expect(frameOriginOf(frame, 'https://shop.partner.com')).toBe('https://k7.webpreview.store')
    expect(frameOriginOf(frame.replace('https', 'http'), 'https://shop.partner.com')).toBeNull()
    expect(frameOriginOf('https://k7.webpreview.store/other/', 'https://shop.partner.com')).toBeNull()
    expect(frameOriginOf(frame, 'https://k7.webpreview.store')).toBeNull()
    expect(frameOriginOf('not a url', 'https://shop.partner.com')).toBeNull()
  })

  it('keeps the session in the path of every page it shows', () => {
    expect(frameAddress(frame, '/')).toBe(frame)
    expect(frameAddress(frame, '/policies/terms/')).toBe(`${frame}policies/terms/`)
    expect(frameAddress(frame, '//evil.example.com/')).toBe(`${frame}evil.example.com/`)
    expect(frameAddress(frame, '/../x/')).toBe(frame)
    expect(frameAddress(frame, '/a/../../../x')).toBe(frame)
  })

  it('hears only the frame’s window from its origin, and only the protocol’s messages', () => {
    const win = {}
    const ok = { origin: 'https://k7.webpreview.store', source: win }
    expect(frameMessage({ ...ok, data: { type: 'df-studio:page', path: '/faq' } }, ok.origin, win)).toEqual({ type: 'df-studio:page', path: '/faq' })
    expect(frameMessage({ ...ok, origin: 'https://evil.example.com', data: { type: 'df-studio:page', path: '/faq' } }, ok.origin, win)).toBeNull()
    expect(frameMessage({ ...ok, source: {}, data: { type: 'df-studio:page', path: '/faq' } }, ok.origin, win)).toBeNull()
    expect(frameMessage({ ...ok, data: { type: 'df-studio:page', path: 'https://evil.example.com' } }, ok.origin, win)).toBeNull()
    expect(frameMessage({ ...ok, data: { type: 'df-studio:text', key: 'pages:home.lead', extra: 1 } }, ok.origin, win)).toBeNull()
    expect(frameMessage({ ...ok, data: { type: 'df-studio:page', path: '/faq' } }, ok.origin, null)).toBeNull()
  })

  it('reads a text key’s page, and shared words with the page shown', () => {
    expect(textPageOf('pages:about.lead', 'home')).toBe('about')
    expect(textPageOf('common:footer.note', 'home')).toBe('home')
  })

  it('lists empty groups out, and names notes it knows only', () => {
    expect(pageGroups({ product: null, content: [], custom: [] }).map((g) => g.label)).toEqual([words.studio.groups.shop, words.studio.groups.policies])
    expect(noteText('template:baseline', (k) => k)).toBe(words.studio.chat.notes.scratch)
    expect(noteText('template:bloom', () => 'Bloom')).toBe(fill(words.studio.chat.notes.template, { name: 'Bloom' }))
    expect(noteText('something:new', (k) => k)).toBeNull()
  })

  it('takes a website only as a full https address', () => {
    expect(sampleAddress(' https://www.example.com/a ')).toBe('https://www.example.com/a')
    expect(sampleAddress('http://www.example.com')).toBeNull()
    expect(sampleAddress('https://localhost')).toBeNull()
    expect(sampleAddress('example.com')).toBeNull()
  })
})
