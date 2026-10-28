import AsyncStorage from '@react-native-async-storage/async-storage'
import { latestPosition } from './position'
import { reportLatest } from './task'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }))
jest.mock('./tracking', () => ({ trackingTask: 'df-delivery-position', stopTracking: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@dripfunnel/mobile-shared/brand', () => ({ storeHost: () => 'acme.my-store.one' }))
jest.mock('../session/token', () => ({ loadToken: jest.fn().mockResolvedValue('token-1') }))

const sent: unknown[] = []
jest.mock('../api/dispatch', () => ({
  reportPosition: (_client: unknown, position: unknown) => {
    sent.push(position)
    return Promise.resolve()
  },
}))

const points = [
  { coords: { latitude: 1, longitude: 1, accuracy: 9 }, timestamp: Date.UTC(2026, 0, 1, 10, 0, 0) },
  { coords: { latitude: 2, longitude: 3, accuracy: null }, timestamp: Date.UTC(2026, 0, 1, 10, 0, 30) },
]

describe('a position', () => {
  it('is the latest point of the wake-up, and only that', () => {
    expect(latestPosition(points)).toEqual({ lat: 2, lng: 3, accuracy: 0, at: '2026-01-01T10:00:30.000Z' })
    expect(latestPosition([])).toBeNull()
  })

  it('is sent and forgotten: never written to storage or logged', async () => {
    const writes = [jest.spyOn(AsyncStorage, 'setItem'), jest.spyOn(AsyncStorage, 'multiSet')]
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')].map((spy) => spy.mockImplementation(() => undefined))
    await reportLatest(points)
    expect(sent).toHaveLength(1)
    for (const spy of [...writes, ...logs]) expect(spy).not.toHaveBeenCalled()
  })
})
