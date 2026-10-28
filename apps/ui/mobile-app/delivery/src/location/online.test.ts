import * as Location from 'expo-location'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { goOffline, goOnline } from './online'

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: 0 }),
}))

const mocked = Location as jest.Mocked<typeof Location>
const events: string[] = []
const client: ApiClient = {
  request: (query: string) => {
    events.push(query.includes('setOnline') ? 'api:setOnline' : 'api:other')
    return Promise.resolve({ setOnline: { ok: true }, reportPosition: { ok: true } } as never)
  },
}

beforeEach(() => {
  events.length = 0
  jest.clearAllMocks()
  mocked.stopLocationUpdatesAsync.mockImplementation(() => {
    events.push('task:stop')
    return Promise.resolve()
  })
})

describe('going offline', () => {
  it('stops the task before the API is told', async () => {
    await goOffline(client, false)
    expect(events).toEqual(['task:stop', 'api:setOnline'])
  })

  it('puts the task back when the API refuses', async () => {
    const refusing: ApiClient = { request: () => Promise.reject(new Error('RIDER_HAS_PARCEL')) }
    await expect(goOffline(refusing, true)).rejects.toThrow()
    expect(mocked.startLocationUpdatesAsync.mock.calls[0]?.[1]?.timeInterval).toBe(15_000)
  })
})

describe('going online', () => {
  it('starts nothing and tells nobody when location is refused', async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false } as never)
    await expect(goOnline(client, false)).resolves.toBe('denied')
    expect(mocked.startLocationUpdatesAsync).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('tells the API only once the task runs', async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true } as never)
    mocked.startLocationUpdatesAsync.mockImplementation(() => {
      events.push('task:start')
      return Promise.resolve()
    })
    await expect(goOnline(client, false)).resolves.toBe('online')
    expect(events.slice(0, 2)).toEqual(['task:start', 'api:setOnline'])
  })
})
