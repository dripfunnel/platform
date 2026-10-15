import { ApiError } from '../graphql'
import { errorMessage } from './errorMessage'
import { t } from './index'

describe('errorMessage', () => {
  it('words a code by the context it happened in', () => {
    const wrong = new ApiError('INVALID_CREDENTIALS', 'x')
    expect(errorMessage(wrong, 'signIn')).toBe('That email and password don’t match. Check them, or reset your password.')
    expect(errorMessage(wrong, 'password')).toBe('That isn’t your current password.')
    expect(errorMessage(wrong, 'profile')).toBe('That isn’t your password.')
  })

  it('falls back to the code’s own words, then to one message', () => {
    expect(errorMessage(new ApiError('NO_RESPONSE', 'x'), 'signIn')).toBe('We couldn’t reach the server. Check your connection and try again.')
    expect(errorMessage(new ApiError('SOMETHING_NEW', 'x'))).toBe('Something went wrong. Try again in a moment.')
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again in a moment.')
  })

  it('fills in the facts the refusal carries, and says how many tries are left when it knows', () => {
    expect(errorMessage(new ApiError('LOCKED', 'x', { minutes: 15 }))).toBe('Too many wrong tries. Try again in 15 minutes.')
    expect(errorMessage(new ApiError('WRONG_CODE', 'x', { triesLeft: 3 }), 'code')).toBe('That code doesn’t match. 3 tries left before sign-in is paused.')
    expect(errorMessage(new ApiError('WRONG_CODE', 'x'), 'code')).toBe('That code doesn’t match.')
  })

  it('never shows the API’s own words', () => {
    expect(errorMessage(new ApiError('FORBIDDEN', 'Not allowed to open store 4f2a'))).toBe('You don’t have access to that.')
  })
})

describe('the refusals Collections meets', () => {
  it.each(['INVALID_PARENT', 'INVALID_RULE', 'TOO_MANY_COLLECTIONS', 'TOO_MANY_PRODUCTS', 'TOO_MANY_RULES'])('has words of its own for %s, not the generic message', (code) => {
    const error = new ApiError(code, 'API words that are never shown')

    expect(error.code).toBe(code)
    expect(errorMessage(error, 'collections')).not.toBe(t('errors.generic'))
  })
})

describe('the refusals Filters and Menus meet', () => {
  it.each([
    ['filters', 'DUPLICATE_NAME'],
    ['filters', 'TOO_MANY_FILTERS'],
    ['menus', 'INVALID_LINK'],
    ['menus', 'TOO_DEEP'],
    ['menus', 'TOO_MANY_ITEMS'],
  ] as const)('has words of its own for %s %s, not the generic message', (context, code) => {
    const error = new ApiError(code, 'API words that are never shown')

    expect(error.code).toBe(code)
    expect(errorMessage(error, context)).not.toBe(t('errors.generic'))
  })
})

describe('the refusals Size charts meet', () => {
  it.each(['TOO_MANY_SIZE_CHARTS', 'FEATURE_UNAVAILABLE', 'PLAN_LIMIT', 'INVALID_INPUT', 'STALE_REVISION'])('has words of its own for %s, not the generic message', (code) => {
    const error = new ApiError(code, 'API words that are never shown')

    expect(error.code).toBe(code)
    expect(errorMessage(error, 'sizeCharts')).not.toBe(t('errors.generic'))
  })

  it('has words for a refused size chart on a product', () => {
    expect(errorMessage(new ApiError('FEATURE_UNAVAILABLE', 'x'), 'products')).toBe('Size charts aren’t switched on in this store.')
  })
})
