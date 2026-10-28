import { riderPushOf } from './push'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

describe('what a rider push says', () => {
  it.each([
    ['rider.offer', 'offer'],
    ['rider.assigned', 'assigned'],
    ['rider.taken', 'taken'],
    ['rider.cancelled', 'cancelled'],
    ['rider.recalled', 'recalled'],
  ])('reads %s', (kind, expected) => {
    expect(riderPushOf({ kind, deliveryId: 'd1' })).toEqual({ kind: expected, deliveryId: 'd1' })
  })

  it('has no delivery when none is named', () => {
    expect(riderPushOf({ kind: 'rider.taken' })).toEqual({ kind: 'taken', deliveryId: null })
  })

  it('ignores anything else', () => {
    expect(riderPushOf({ kind: 'shop.order' })).toBeNull()
    expect(riderPushOf(null)).toBeNull()
  })
})
