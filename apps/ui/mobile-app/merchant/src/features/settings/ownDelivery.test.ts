import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { defaultRiderKm, delivers, feeMinor, feeText, isPinned, kmText, metresOfKm, minutesOf, missingOf } from './ownDelivery'
import { isMobile, toE164 } from './riders/riderPhone'

describe('own delivery’s distances', () => {
  it('turns whole kilometres from 1 to 50 into the API’s metres, and nothing else', () => {
    expect(metresOfKm('5')).toBe(5000)
    expect(metresOfKm(' 50 ')).toBe(50000)
    expect(metresOfKm('1')).toBe(1000)
    expect(metresOfKm('')).toBeNull()
    for (const bad of ['0', '51', '2.5', '-3', 'five']) expect(metresOfKm(bad)).toBe('invalid')
  })

  it('reads metres back as kilometres, and nothing as empty', () => {
    expect(kmText(7000)).toBe('7')
    expect(kmText(null)).toBe('')
    expect(kmText(undefined)).toBe('')
    expect(defaultRiderKm).toBe(5)
  })

  it('takes an alert time of 1 to 30 whole minutes', () => {
    expect(minutesOf('10')).toBe(10)
    expect(minutesOf('1')).toBe(1)
    expect(minutesOf('30')).toBe(30)
    for (const bad of ['', '0', '31', '1.5', 'x']) expect(minutesOf(bad)).toBeNull()
  })
})

describe('own delivery’s fee', () => {
  it('goes to the API in minor units of the store’s currency, and reads back in major units', () => {
    expect(feeMinor('49', 'INR')).toBe('4900')
    expect(feeMinor('49.50', 'INR')).toBe('4950')
    expect(feeMinor('0', 'INR')).toBe('0')
    expect(feeMinor('', 'INR')).toBeNull()
    expect(feeMinor('free', 'INR')).toBe('invalid')
    expect(feeText({ deliveryFeeAmount: '4900' }, 'INR')).toBe('49.00')
    expect(feeText({ deliveryFeeAmount: null }, 'INR')).toBe('')
  })
})

describe('a location for own delivery', () => {
  it('needs both halves of a pin, and delivers only when switched on', () => {
    expect(isPinned({ latitude: 26.9, longitude: 75.8 })).toBe(true)
    expect(isPinned({ latitude: 26.9, longitude: null })).toBe(false)
    expect(isPinned({})).toBe(false)
    expect(delivers({ ownDelivery: true })).toBe(true)
    expect(delivers({ ownDelivery: null })).toBe(false)
  })
})

describe('what turning own delivery on still needs', () => {
  it('is read from the refusal, keeping only pieces it knows', () => {
    expect(missingOf(new ApiError('OWN_DELIVERY_NOT_READY', 'x', { missing: ['rider', 'warehouse', 'moon'] }))).toEqual(['rider', 'warehouse'])
    expect(missingOf(new ApiError('OWN_DELIVERY_NOT_READY', 'x', { missing: ['plan'] }))).toEqual(['plan'])
    expect(missingOf(new ApiError('OWN_DELIVERY_NOT_READY', 'x'))).toEqual([])
    expect(missingOf(new ApiError('FORBIDDEN', 'x'))).toBeNull()
    expect(missingOf(new Error('boom'))).toBeNull()
  })
})

describe('a rider’s mobile number', () => {
  it('is sent as the API takes it, with the country code typed and never guessed', () => {
    expect(toE164('+91 98765-43210')).toBe('+919876543210')
    expect(toE164('0091 98765 43210')).toBe('+919876543210')
    expect(isMobile('+91 98765 43210')).toBe(true)
    expect(isMobile('98765 43210')).toBe(false)
    expect(isMobile('+')).toBe(false)
  })
})
