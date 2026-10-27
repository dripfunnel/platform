import { ApiError } from '@dripfunnel/mobile-shared/graphql'
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

describe('the refusals own delivery meets', () => {
  it.each(['RIDER_HAS_PARCEL', 'PHONE_TAKEN', 'RATE_LIMITED', 'INVALID_PHONE', 'NOT_INVITED', 'NOT_ACTIVE', 'NOT_SUSPENDED', 'PLAN_LIMIT', 'UNAVAILABLE'])('has words of its own for a rider’s %s', (code) => {
    const error = new ApiError(code, 'API words that are never shown')

    expect(error.code).toBe(code)
    expect(errorMessage(error, 'settingsRiders')).not.toBe(t('errors.generic'))
  })

  it.each(['NOT_PACKING', 'NOT_UNASSIGNED', 'NOT_CANCELLABLE', 'NOT_PICKED_UP', 'CODE_NOT_LOCKED', 'NOT_HANDED_OVER', 'NOT_ENOUGH_STOCK', 'NOT_SHIPPABLE', 'NOT_PENDING', 'UNAVAILABLE', 'FORBIDDEN'])('has words of its own for a delivery’s %s', (code) => {
    expect(errorMessage(new ApiError(code, 'x'), 'delivery')).not.toBe(t('errors.generic'))
  })

  it('says a delivery refusal in the delivery’s words, not the order’s', () => {
    expect(errorMessage(new ApiError('NOT_CANCELLABLE', 'x'), 'delivery')).toBe('This delivery can’t be cancelled now.')
    expect(errorMessage(new ApiError('RIDER_HAS_PARCEL', 'x'), 'settingsRiders')).toBe('They’re carrying an order: recall it first.')
  })

  it('has words for a location that needs a pin and a delivery area, and for own delivery that is not ready', () => {
    expect(errorMessage(new ApiError('DELIVERY_AREA_REQUIRED', 'x'), 'settingsWarehouse')).toBe('Set the map pin and a delivery area first.')
    expect(errorMessage(new ApiError('OWN_DELIVERY_NOT_READY', 'x', { missing: ['rider'] }), 'settingsShipping')).toBe('Own delivery can’t be turned on yet. Finish the steps listed above.')
  })
})
