import { ApiError } from '@dripfunnel/shared/graphql'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { brandComplete, brandFormOf, brandProblemOf, pickerValue } from './brandDraft'
import { storefrontAccessOf } from './storefrontAccess'

const words = messages.storefront

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
