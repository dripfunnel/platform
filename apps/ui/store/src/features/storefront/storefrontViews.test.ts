import { ApiError } from '@dripfunnel/shared/graphql'
import { describe, expect, it } from 'vitest'
import type { StorefrontDomain } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { brandComplete, brandFormOf, brandProblemOf, pickerValue } from './brandDraft'
import { canCancel, canMakePrimary, domainRefusal, inProgress, needsRecords } from './domainView'
import { counterText, googleTitle, seoTooLong } from './seoView'
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
